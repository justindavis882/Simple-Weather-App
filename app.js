// The NWS requires a descriptive User-Agent header
const APP_IDENTIFIER = 'SimpleWeatherPWA/1.0 (your-email@example.com)';
const headers = { 'User-Agent': APP_IDENTIFIER };

// DOM Elements
const getLocBtn = document.getElementById('getLocationBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchBtn = document.getElementById('searchBtn');
const locationInput = document.getElementById('locationInput');
const weatherContainer = document.getElementById('weather-container');
const alertsContainer = document.getElementById('alerts-container');
const hourlyContainer = document.getElementById('hourly-container');
const dailyContainer = document.getElementById('daily-container');

// Map instance
let map = null;

// 1. Register the Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// 2. Event Listeners for Location Data
getLocBtn.addEventListener('click', () => {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    getLocBtn.textContent = 'Locating...';
    navigator.geolocation.getCurrentPosition(fetchWeatherData, handleLocationError);
});

refreshBtn.addEventListener('click', () => {
    refreshBtn.textContent = '...';
    navigator.geolocation.getCurrentPosition(fetchWeatherData, handleLocationError);
});

searchBtn.addEventListener('click', async () => {
    const query = locationInput.value.trim();
    if (!query) return;
    
    searchBtn.textContent = '...';
    try {
        // Swap to OpenStreetMap (Nominatim) Geocoder to resolve CORS blocking
        // Nominatim requires a User-Agent just like NWS, so we reuse your APP_IDENTIFIER
        const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`, {
            headers: { 'User-Agent': APP_IDENTIFIER }
        });
        
        const data = await response.json();
        
        if (data.length > 0) {
            // Nominatim returns lat and lon as strings in the first array item
            const coords = data[0];
            const position = { 
                coords: { 
                    latitude: parseFloat(coords.lat), 
                    longitude: parseFloat(coords.lon) 
                } 
            };
            fetchWeatherData(position);
        } else {
            alert('Location not found. Try a valid zip code or "City, State".');
        }
    } catch (err) {
        console.error(err);
        alert('Error searching for location.');
    } finally {
        searchBtn.textContent = 'Search';
    }
});

// 3. Core Data Fetching Function
async function fetchWeatherData(position) {
    const lat = position.coords.latitude.toFixed(4);
    const lon = position.coords.longitude.toFixed(4);
    
    try {
        // Step 1: Translate coordinates to NWS Gridpoint
        const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
        if (!pointRes.ok) throw new Error('Failed to fetch gridpoint data');
        const pointData = await pointRes.json();
        
        const { forecast, forecastHourly } = pointData.properties;

        // Step 2: Fetch Forecasts and Alerts concurrently
        const [dailyRes, hourlyRes, alertsRes] = await Promise.all([
            fetch(forecast, { headers }),
            fetch(forecastHourly, { headers }),
            fetch(`https://api.weather.gov/alerts/active?point=${lat},${lon}`, { headers })
        ]);

        const dailyData = await dailyRes.json();
        const hourlyData = await hourlyRes.json();
        const alertsData = await alertsRes.json();

        // Step 3: Update the UI
        getLocBtn.classList.add('hidden');
        weatherContainer.classList.remove('hidden');
        
        refreshBtn.classList.remove('hidden');
        refreshBtn.textContent = 'GPS';    

        renderAlerts(alertsData.features);
        renderHourly(hourlyData.properties.periods.slice(0, 24)); 
        renderDaily(dailyData.properties.periods);
        
        // Step 4: Render/Update the Live Radar
        updateRadar(lat, lon);

    } catch (error) {
        console.error(error);
        alert('Error communicating with the National Weather Service.');
        getLocBtn.textContent = 'Try Again';
        refreshBtn.textContent = 'GPS';
    }
}

function handleLocationError(error) {
    console.error(error);
    alert('Unable to retrieve your location. Please check your permissions.');
    getLocBtn.textContent = 'Load My Weather';
    refreshBtn.textContent = 'GPS';
}

// 4. UI Rendering Functions
function renderAlerts(alerts) {
    alertsContainer.innerHTML = '';
    if (!alerts || alerts.length === 0) return;
    
    alertsContainer.innerHTML = alerts.map(alert => `
        <div class="alert">
            <strong>${alert.properties.event}</strong>
            <span style="font-size: 0.9em; display: block; margin-top: 4px;">${alert.properties.headline}</span>
        </div>
    `).join('');
}

function renderHourly(periods) {
    hourlyContainer.innerHTML = periods.map(period => {
        const timeString = new Date(period.startTime).toLocaleTimeString([], { hour: 'numeric' });
        return `
            <div class="hourly-card">
                <div style="font-weight: 500;">${timeString}</div>
                <img src="${period.icon}" alt="${period.shortForecast}">
                <div style="font-size: 1.2em; font-weight: bold;">${period.temperature}&deg;${period.temperatureUnit}</div>
                <div style="font-size: 0.8em; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">${period.shortForecast}</div>
            </div>
        `;
    }).join('');
}

function renderDaily(periods) {
    dailyContainer.innerHTML = periods.map(period => `
        <div class="daily-row">
            <div style="flex: 1; font-weight: bold;">${period.name}</div>
            <div style="flex: 1; text-align: center;">
                <img src="${period.icon}" alt="${period.shortForecast}">
            </div>
            <div style="flex: 1; text-align: right; font-size: 1.2em; font-weight: bold;">
                ${period.temperature}&deg;${period.temperatureUnit}
            </div>
            <div style="flex: 2; text-align: right; font-size: 0.9em; color: rgba(255, 255, 255, 0.7); padding-left: 12px;">
                ${period.shortForecast}
            </div>
        </div>
    `).join('');
}

function updateRadar(lat, lon) {
    if (!map) {
        // Initialize the map
        map = L.map('radar-map').setView([lat, lon], 7);
        
        // Base street layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap',
            className: 'map-base-layer'
        }).addTo(map);

        // NOAA Radar layer
        L.tileLayer.wms('https://mapservices.weather.noaa.gov/eventdriven/services/radar/radar_base_reflectivity/MapServer/WMSServer', {
            layers: '0', 
            format: 'image/png',
            transparent: true,
            opacity: 0.65,
            attribution: 'NOAA / NWS'
        }).addTo(map);

    } else {
        // Update existing map location
        map.setView([lat, lon], 7);
    }
    
    // CRITICAL FIX: Tell Leaflet the container size has changed since it was originally hidden
    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}