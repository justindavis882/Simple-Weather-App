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
const testAlertBtn = document.getElementById('testAlertBtn');

// Initialize saved locations from local storage
let savedLocations = JSON.parse(localStorage.getItem('weather_saved_locations')) || [];

function renderSavedLocations() {
    const container = document.getElementById('saved-locations-container');
    if (savedLocations.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    container.innerHTML = savedLocations.map(loc => `
        <button class="saved-chip" onclick="loadSavedLocation(${loc.lat}, ${loc.lon})">
            ${loc.name}
        </button>
    `).join('');
}

// Global function so the inline onclick handler can reach it
window.loadSavedLocation = (lat, lon) => {
    const position = { coords: { latitude: lat, longitude: lon } };
    fetchWeatherData(position);
};

// Global function to save a new location
window.saveCurrentLocation = (name, lat, lon) => {
    if (!savedLocations.find(loc => loc.name === name)) {
        savedLocations.push({ name, lat, lon });
        localStorage.setItem('weather_saved_locations', JSON.stringify(savedLocations));
        renderSavedLocations();
        alert(`${name} saved!`);
    } else {
        alert(`${name} is already saved.`);
    }
};

// Render chips on initial load
renderSavedLocations();

// Map instance
let map = null;

// 1. Register the Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// --- PWA Installation Logic ---
let deferredPrompt;
const installBtn = document.getElementById('installBtn');

// The browser fires this when the PWA is ready to be installed
window.addEventListener('beforeinstallprompt', (e) => {
    // Prevent the default browser install UI from showing
    e.preventDefault();
    // Save the event so it can be triggered later
    deferredPrompt = e;
    // Reveal your custom install button
    installBtn.classList.remove('hidden');
});

installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    
    // Show the native OS installation prompt
    deferredPrompt.prompt();
    
    // Wait for the user to accept or dismiss the prompt
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
        installBtn.classList.add('hidden');
    }
    
    // The prompt event can only be used once, so clear it
    deferredPrompt = null;
});

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

testAlertBtn.addEventListener('click', () => {
    // Unhide the main container so you can see the results immediately
    weatherContainer.classList.remove('hidden');
    
    // Create a mock NWS alert payload
    const mockAlertData = [
        {
            properties: {
                event: "Test Warning",
                headline: "All Weather Alerts will appear in this format. Please read all warnings and stay safe."
            }
        }
    ];

    // Pass the mock data to your existing render function
    renderAlerts(mockAlertData);
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
        
        // NEW: Extract the City and State from the NWS data
        const city = pointData.properties.relativeLocation.properties.city;
        const state = pointData.properties.relativeLocation.properties.state;
        const locationName = `${city}, ${state}`;

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
        renderCurrentWeather(dailyData.properties.periods[0], locationName, lat, lon);
        renderHourly(hourlyData.properties.periods.slice(0, 24)); 
        renderDaily(dailyData.properties.periods);
        
        updateRadar(lat, lon);
        
        // NEW: Fetch and render tides in the background
        fetchTides(lat, lon);

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
    
    // 1. Clear the badge if there are no alerts
    if ('clearAppBadge' in navigator) {
        navigator.clearAppBadge().catch(console.error);
    }
    
    if (!alerts || alerts.length === 0) return;
    
    // 2. Set the badge number to the total amount of active alerts
    if ('setAppBadge' in navigator) {
        navigator.setAppBadge(alerts.length).catch(console.error);
    }

    // 3. Check if any alert is a severe "Warning"
    const hasSevereWarning = alerts.some(alert => 
        alert.properties.event.toLowerCase().includes('warning')
    );

    // If there is a warning and the device supports vibration, pulse the motor
    if (hasSevereWarning && 'vibrate' in navigator) {
        // Vibration pattern: 500ms on, 250ms off, 500ms on
        navigator.vibrate([500, 250, 500]);
    }
    
    alertsContainer.innerHTML = alerts.map(alert => `
        <div class="alert">
            <button class="close-alert" onclick="this.parentElement.style.display='none'">&times;</button>
            <strong style="padding-right: 30px;">${alert.properties.event}</strong>
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

function renderCurrentWeather(period, locationName, lat, lon) {
    const currentContainer = document.getElementById('current-weather-container');
    
    currentContainer.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
            <div>
                <h2 style="margin: 0; border-bottom: none; padding-bottom: 0;">${locationName}</h2>
                <div style="font-size: 0.9em; color: rgba(255, 255, 255, 0.7); margin-top: 4px;">${period.name}</div>
            </div>
            <button class="save-loc-btn" onclick="saveCurrentLocation('${locationName}', ${lat}, ${lon})">
                ⭐ Save
            </button>
        </div>
        
        <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 16px;">
            <div>
                <div style="font-size: 3.5rem; font-weight: bold; line-height: 1;">${period.temperature}&deg;${period.temperatureUnit}</div>
                <div style="font-size: 1.1rem; color: rgba(255, 255, 255, 0.8); margin-top: 8px;">${period.shortForecast}</div>
            </div>
            <img src="${period.icon}" alt="${period.shortForecast}" style="width: 85px; height: 85px; border-radius: 50%; box-shadow: 0 4px 8px rgba(0,0,0,0.2);">
        </div>
    `;
}

// --- Tide API Functions ---

// 1. Calculate distance between two coordinates (Haversine formula)
function getDistanceInMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius of the earth in miles
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// 2. Fetch the tides
async function fetchTides(lat, lon) {
    const tidesContainer = document.getElementById('tides-container');
    const tidesList = document.getElementById('tides-list');
    const tideStationName = document.getElementById('tide-station-name');

    try {
        // Step A: Get the master list of all NOAA tide stations
        const stationRes = await fetch('https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions');
        const stationData = await stationRes.json();
        
        // Step B: Find the closest station to our coordinates
        let closestStation = null;
        let shortestDistance = Infinity;

        stationData.stations.forEach(station => {
            const distance = getDistanceInMiles(lat, lon, station.lat, station.lng);
            if (distance < shortestDistance) {
                shortestDistance = distance;
                closestStation = station;
            }
        });

        // Step C: If the closest station is more than 30 miles away, we are likely inland. Hide the widget.
        if (shortestDistance > 30) {
            tidesContainer.classList.add('hidden');
            return;
        }

        // Step D: Fetch today's High/Low predictions for the closest station
        // interval=hilo specifically asks for just the High and Low tide events
        const tideRes = await fetch(`https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&station=${closestStation.id}&product=predictions&datum=MLLW&time_zone=lst_ldt&interval=hilo&units=english&application=${encodeURIComponent(APP_IDENTIFIER)}&format=json`);
        const tideData = await tideRes.json();

        if (tideData.predictions) {
            tidesContainer.classList.remove('hidden');
            tideStationName.textContent = `Tides: ${closestStation.name}`;
            
            tidesList.innerHTML = tideData.predictions.map(pred => {
                // Parse the time string (e.g., "2026-08-08 14:30") into a readable format
                const tideTime = new Date(pred.t.replace(/-/g, '/')).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                const isHigh = pred.type === 'H';
                
                return `
                    <div class="tide-row">
                        <div class="tide-type">${isHigh ? 'High Tide' : 'Low Tide'}</div>
                        <div class="tide-time">${tideTime}</div>
                        <div class="tide-height">${pred.v} ft</div>
                    </div>
                `;
            }).join('');
        } else {
            tidesContainer.classList.add('hidden');
        }

    } catch (error) {
        console.error('Error fetching tides:', error);
        tidesContainer.classList.add('hidden'); // Fail silently so it doesn't break the weather app
    }
}