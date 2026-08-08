// The NWS requires a descriptive User-Agent header
const APP_IDENTIFIER = 'SimpleWeatherPWA/1.0 (justindavis882@gmail.com)';
const headers = { 'User-Agent': APP_IDENTIFIER };

// DOM Elements
const getLocBtn = document.getElementById('getLocationBtn');
const refreshBtn = document.getElementById('refreshBtn');
const weatherContainer = document.getElementById('weather-container');
const alertsContainer = document.getElementById('alerts-container');
const hourlyContainer = document.getElementById('hourly-container');
const dailyContainer = document.getElementById('daily-container');

// 1. Register the Service Worker (for PWA offline support and caching)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js')
            .catch(err => console.error('Service Worker registration failed:', err));
    });
}

// 2. Handle Geolocation & Refresh Actions
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

async function fetchWeatherData(position) {
    const lat = position.coords.latitude.toFixed(4);
    const lon = position.coords.longitude.toFixed(4);
    
    try {
        // Step 1: Translate coordinates to NWS Gridpoint
        const pointRes = await fetch(`https://api.weather.gov/points/${lat},${lon}`, { headers });
        if (!pointRes.ok) throw new Error('Failed to fetch gridpoint data');
        const pointData = await pointRes.json();
        
        // Extract the specific forecast URLs provided by the NWS for this grid
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
        
        // Show and reset the refresh button in the header
        refreshBtn.classList.remove('hidden');
        refreshBtn.textContent = 'Refresh';    

        renderAlerts(alertsData.features);
        // Slice the first 24 periods for the hourly view
        renderHourly(hourlyData.properties.periods.slice(0, 24)); 
        renderDaily(dailyData.properties.periods);

    } catch (error) {
        console.error(error);
        alert('Error communicating with the National Weather Service.');
        getLocBtn.textContent = 'Try Again';
        refreshBtn.textContent = 'Refresh';
    }
}

function handleLocationError(error) {
    console.error(error);
    alert('Unable to retrieve your location. Please check your permissions.');
    getLocBtn.textContent = 'Load My Weather';
    refreshBtn.textContent = 'Refresh';
}

// --- UI Rendering Functions ---

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
        // Convert startTime to a readable hour
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
