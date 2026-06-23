/* ===== STATE ===== */
let appState = {
  mode: 'fishing',
  lat: null,
  lon: null,
  locationName: null,
  stateCode: null,
  waterData: {},
  weatherData: {},
  apiKey: localStorage.getItem('fieldguide_apikey') || '',
  conversationHistory: [],
  isLoading: false
};

/* ===== INIT ===== */
window.addEventListener('DOMContentLoaded', () => {
  if (!appState.apiKey) {
    openSettings();
  }
});

/* ===== SETTINGS ===== */
function openSettings() {
  const modal = document.getElementById('settingsModal');
  modal.classList.add('active');
  document.getElementById('apiKeyInput').value = appState.apiKey;
}

document.getElementById('closeSettings').onclick = () => {
  if (appState.apiKey) {
    document.getElementById('settingsModal').classList.remove('active');
  }
};

document.getElementById('saveSettings').onclick = () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('sk-ant-')) {
    alert('Please enter a valid Claude API key (starts with sk-ant-)');
    return;
  }
  appState.apiKey = key;
  localStorage.setItem('fieldguide_apikey', key);
  document.getElementById('settingsModal').classList.remove('active');
};

/* ===== MODE ===== */
function setMode(mode) {
  appState.mode = mode;
  appState.conversationHistory = [];
  document.body.className = `mode-${mode}`;

  document.getElementById('fishingBtn').classList.toggle('active', mode === 'fishing');
  document.getElementById('huntingBtn').classList.toggle('active', mode === 'hunting');
  document.getElementById('modeIcon').textContent = mode === 'fishing' ? '🎣' : '🦌';
  document.getElementById('introIcon').textContent = mode === 'fishing' ? '🎣' : '🦌';
  document.getElementById('introText').textContent = mode === 'fishing'
    ? 'Tell me what you\'re after. Be specific — the more detail you give, the better the advice.'
    : 'Tell me what you\'re hunting. Include your setup, target species, and time frame.';

  updateWaterCard(mode);
  updateTipsPanel();
  updateChips(mode);
  resetChat();
}

function updateWaterCard(mode) {
  const title = document.getElementById('waterCardTitle');
  const icon = document.querySelector('#waterCard .card-icon');
  title.textContent = mode === 'fishing' ? 'Water Conditions' : 'Terrain & Wind';
  icon.textContent = mode === 'fishing' ? '💧' : '🗺';
}

function updateChips(mode) {
  const chips = document.getElementById('promptChips');
  if (mode === 'fishing') {
    chips.innerHTML = `
      <button class="chip" onclick="useChip(this)">I'm fishing for brown trout right now</button>
      <button class="chip" onclick="useChip(this)">What lures should I use today?</button>
      <button class="chip" onclick="useChip(this)">Where should I cast from the bank?</button>
      <button class="chip" onclick="useChip(this)">Best time to be on the water today?</button>
    `;
  } else {
    chips.innerHTML = `
      <button class="chip" onclick="useChip(this)">I'm elk hunting in Colorado tomorrow</button>
      <button class="chip" onclick="useChip(this)">Where should I set up a blind?</button>
      <button class="chip" onclick="useChip(this)">What gear do I need for this weather?</button>
      <button class="chip" onclick="useChip(this)">Where will deer be at first light?</button>
    `;
  }
}

function resetChat() {
  document.getElementById('chatMessages').innerHTML = '';
  document.getElementById('chatIntro').classList.remove('hidden');
}

function useChip(btn) {
  document.getElementById('chatInput').value = btn.textContent;
  sendMessage();
}

/* ===== GEOLOCATION ===== */
async function getLocation() {
  const statusEl = document.getElementById('locStatus');
  const textEl = document.getElementById('locationText');
  const btn = document.getElementById('locateBtn');

  textEl.textContent = 'Detecting location...';
  statusEl.innerHTML = '<span class="spinner"></span>';
  btn.style.opacity = '0.5';

  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      appState.lat = pos.coords.latitude;
      appState.lon = pos.coords.longitude;
      btn.style.opacity = '1';

      await Promise.all([
        reverseGeocode(appState.lat, appState.lon),
        fetchWeather(appState.lat, appState.lon),
        fetchWaterData(appState.lat, appState.lon)
      ]);

      updateTipsPanel();
    },
    (err) => {
      textEl.textContent = 'Location access denied. Enter your location in the chat.';
      statusEl.textContent = '';
      btn.style.opacity = '1';
    },
    { timeout: 10000, enableHighAccuracy: true }
  );
}

async function reverseGeocode(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`);
    const data = await res.json();
    const addr = data.address;
    const city = addr.city || addr.town || addr.village || addr.county || '';
    const state = addr.state_code || addr.state || '';
    appState.locationName = [city, state].filter(Boolean).join(', ');
    appState.stateCode = addr.state_code || '';
    document.getElementById('locationText').textContent = appState.locationName || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    document.getElementById('locStatus').textContent = 'Located';
  } catch (e) {
    document.getElementById('locationText').textContent = `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    document.getElementById('locStatus').textContent = '';
  }
}

/* ===== USGS WATER DATA ===== */
async function fetchWaterData(lat, lon) {
  document.getElementById('waterBadge').textContent = 'Loading…';
  const bbox = `${(lon - 0.5).toFixed(4)},${(lat - 0.5).toFixed(4)},${(lon + 0.5).toFixed(4)},${(lat + 0.5).toFixed(4)}`;
  const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&bBox=${bbox}&parameterCd=00060,00065,00010&siteType=ST&siteStatus=active`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const series = data?.value?.timeSeries;
    if (!series || series.length === 0) {
      document.getElementById('waterBadge').textContent = 'No gauge nearby';
      return;
    }

    const gauges = {};
    for (const s of series) {
      const siteCode = s.sourceInfo.siteCode[0].value;
      const siteName = s.sourceInfo.siteName;
      const varCode = s.variable.variableCode[0].value;
      const latestVal = s.values[0]?.value[0]?.value;
      if (!gauges[siteCode]) gauges[siteCode] = { name: siteName };
      gauges[siteCode][varCode] = latestVal;
    }

    const firstGauge = Object.values(gauges)[0];
    const siteName = Object.values(gauges)[0]?.name || '';
    const flow = firstGauge['00060'];
    const height = firstGauge['00065'];
    const waterTemp = firstGauge['00010'];

    appState.waterData = { flow, height, waterTemp, siteName };

    document.getElementById('flowRate').textContent = flow ? `${parseFloat(flow).toFixed(0)} cfs` : '—';
    document.getElementById('gaugeHeight').textContent = height ? `${parseFloat(height).toFixed(2)} ft` : '—';
    document.getElementById('waterTemp').textContent = waterTemp ? `${cToF(parseFloat(waterTemp)).toFixed(1)}°F` : '—';
    document.getElementById('waterClarity').textContent = height ? clarityFromHeight(parseFloat(height)) : '—';
    document.getElementById('gaugeName').textContent = siteName ? `📡 ${siteName}` : '';
    document.getElementById('waterBadge').textContent = 'LIVE';
  } catch (e) {
    document.getElementById('waterBadge').textContent = 'Unavailable';
  }
}

function cToF(c) { return (c * 9 / 5) + 32; }
function clarityFromHeight(height) {
  if (height < 1) return 'Very Clear';
  if (height < 2) return 'Clear';
  if (height < 4) return 'Slightly Turbid';
  if (height < 6) return 'Turbid';
  return 'Muddy';
}

/* ===== NOAA WEATHER ===== */
async function fetchWeather(lat, lon) {
  document.getElementById('weatherBadge').textContent = 'Loading…';
  try {
    const pointRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
    const pointData = await pointRes.json();
    const forecastUrl = pointData.properties.forecast;
    const hourlyUrl = pointData.properties.forecastHourly;

    const [forecastRes, hourlyRes] = await Promise.all([
      fetch(forecastUrl),
      fetch(hourlyUrl)
    ]);
    const forecast = await forecastRes.json();
    const hourly = await hourlyRes.json();

    const current = hourly.properties.periods[0];
    const periods = forecast.properties.periods;

    const windSpeed = current.windSpeed || '—';
    const windDir = current.windDirection || '';
    const temp = current.temperature;
    const shortForecast = current.shortForecast || '';

    appState.weatherData = { temp, windSpeed, windDir, shortForecast, periods };

    document.getElementById('temperature').textContent = `${temp}°F`;
    document.getElementById('wind').textContent = `${windSpeed} ${windDir}`;
    document.getElementById('sky').textContent = shortForecast;
    document.getElementById('pressure').textContent = getPressureTrend(periods);
    document.getElementById('weatherBadge').textContent = 'LIVE';

    renderForecast(periods.slice(0, 6));
  } catch (e) {
    document.getElementById('weatherBadge').textContent = 'Unavailable';
  }
}

function getPressureTrend(periods) {
  if (!periods || periods.length < 2) return '—';
  const words = (periods[0].detailedForecast || '').toLowerCase();
  if (words.includes('rising')) return 'Rising ↑';
  if (words.includes('falling') || words.includes('decreasing')) return 'Falling ↓';
  return 'Steady →';
}

function renderForecast(periods) {
  const row = document.getElementById('forecastRow');
  row.innerHTML = '';
  const seen = new Set();
  for (const p of periods) {
    const dayLabel = p.name.split(' ')[0];
    if (seen.has(dayLabel)) continue;
    seen.add(dayLabel);
    const icon = weatherIcon(p.shortForecast);
    row.innerHTML += `
      <div class="forecast-item">
        <div class="forecast-day">${dayLabel}</div>
        <div class="forecast-icon">${icon}</div>
        <div class="forecast-temp">${p.temperature}°</div>
      </div>`;
  }
}

function weatherIcon(forecast) {
  const f = (forecast || '').toLowerCase();
  if (f.includes('thunder')) return '⛈';
  if (f.includes('snow')) return '❄️';
  if (f.includes('rain') || f.includes('shower')) return '🌧';
  if (f.includes('cloud') && f.includes('partly')) return '⛅';
  if (f.includes('cloud') || f.includes('overcast')) return '☁️';
  if (f.includes('sun') || f.includes('clear') || f.includes('sunny')) return '☀️';
  if (f.includes('wind')) return '💨';
  if (f.includes('fog')) return '🌫';
  return '🌤';
}

/* ===== TIPS PANEL ===== */
function updateTipsPanel() {
  const icon = document.getElementById('tipsIcon');
  const title = document.getElementById('tipsTitle');
  const content = document.getElementById('tipsContent');

  if (appState.mode === 'fishing') {
    icon.textContent = '🐟';
    title.textContent = 'Local Species & Tips';
    const temp = parseFloat(document.getElementById('waterTemp').textContent) || null;
    const flow = parseFloat(document.getElementById('flowRate').textContent) || null;
    content.innerHTML = buildFishingTips(temp, flow);
  } else {
    icon.textContent = '🦌';
    title.textContent = 'Wildlife & Tactics';
    const weatherText = document.getElementById('sky').textContent;
    const tempF = parseInt(document.getElementById('temperature').textContent) || null;
    content.innerHTML = buildHuntingTips(tempF, weatherText);
  }
}

function buildFishingTips(waterTempF, flowCfs) {
  const tags = [];
  const tips = [];

  if (waterTempF) {
    if (waterTempF < 45) {
      tags.push('Brown Trout', 'Rainbow Trout');
      tips.push('Cold water — trout active in midday heat. Fish slow and deep with weighted nymphs.');
    } else if (waterTempF < 65) {
      tags.push('Brown Trout', 'Rainbow Trout', 'Brook Trout', 'Bass');
      tips.push('Ideal trout temps. Prime window is early morning and evening. Dry flies can work mid-day.');
    } else {
      tags.push('Smallmouth Bass', 'Largemouth Bass', 'Pike', 'Panfish');
      tips.push('Warm water stresses trout. Target bass, pike, and panfish. Fish early or late.');
    }
  } else {
    tags.push('Trout', 'Bass', 'Panfish');
    tips.push('Detect your location for local species and water temperature advice.');
  }

  if (flowCfs) {
    if (flowCfs < 50) tips.push('Low flows — fish are spooky. Use light tippet (5x-6x) and small flies. Approach quietly.');
    else if (flowCfs < 500) tips.push('Normal flows — standard presentations work well. Focus on seams and pools.');
    else tips.push('High flows — fish hugging banks and structure. Use heavier, brighter streamers with extra weight.');
  }

  const tagsHtml = tags.map(t => `<span class="species-tag">${t}</span>`).join('');
  const tipsHtml = tips.map(t => `<p>• ${t}</p>`).join('');
  return tagsHtml + '<br><br>' + tipsHtml;
}

function buildHuntingTips(tempF, weatherDesc) {
  const tags = [];
  const tips = [];

  if (tempF !== null) {
    if (tempF < 30) {
      tags.push('Whitetail Deer', 'Elk', 'Mule Deer');
      tips.push('Cold temps — deer and elk moving more to feed. All-day activity likely. South-facing slopes will hold warmth.');
    } else if (tempF < 55) {
      tags.push('Whitetail Deer', 'Turkey', 'Elk', 'Bear');
      tips.push('Prime movement temps. Focus on travel corridors between bedding and feeding areas during first and last hour of light.');
    } else {
      tags.push('Turkey', 'Hog', 'Predator');
      tips.push('Warm temps reduce big game movement. Deer bed early. Focus on evening hunts near water sources and food plots.');
    }
  } else {
    tags.push('Deer', 'Elk', 'Turkey', 'Bear');
    tips.push('Detect your location for local species and movement predictions.');
  }

  if (weatherDesc && weatherDesc !== '—') {
    const w = weatherDesc.toLowerCase();
    if (w.includes('rain') || w.includes('storm')) tips.push('Hunt just before the front — animals go on a feeding frenzy. After rain, expect heavy bedding.');
    if (w.includes('wind') || parseInt(document.getElementById('wind').textContent) > 15) tips.push('High winds mask your movement but also mask deer senses. Hunt low in hollows and sheltered valleys.');
    if (w.includes('clear') || w.includes('sun')) tips.push('Clear conditions — deer rely more on sight. Wear full camo and stay downwind. Use the sun angle to your advantage.');
  }

  const tagsHtml = tags.map(t => `<span class="species-tag">${t}</span>`).join('');
  const tipsHtml = tips.map(t => `<p>• ${t}</p>`).join('');
  return tagsHtml + '<br><br>' + tipsHtml;
}

/* ===== CHAT ===== */
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text || appState.isLoading) return;

  if (!appState.apiKey) {
    openSettings();
    return;
  }

  hideIntro();
  addMessage('user', text);
  input.value = '';
  input.style.height = 'auto';

  const typingId = addTyping();
  appState.isLoading = true;
  document.getElementById('sendBtn').disabled = true;

  try {
    const response = await callClaude(text);
    removeTyping(typingId);
    addMessage('assistant', response);
    appState.conversationHistory.push(
      { role: 'user', content: text },
      { role: 'assistant', content: response }
    );
  } catch (e) {
    removeTyping(typingId);
    addMessage('assistant', `Sorry, I couldn't reach the AI right now. Check your API key in settings, then try again.\n\nError: ${e.message}`);
  }

  appState.isLoading = false;
  document.getElementById('sendBtn').disabled = false;
}

function hideIntro() {
  document.getElementById('chatIntro').classList.add('hidden');
}

function addMessage(role, text) {
  const container = document.getElementById('chatMessages');
  const avatar = role === 'user' ? '👤' : (appState.mode === 'fishing' ? '🎣' : '🦌');
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.innerHTML = `
    <div class="msg-avatar">${avatar}</div>
    <div class="msg-bubble">${formatMessage(text)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function addTyping() {
  const container = document.getElementById('chatMessages');
  const id = 'typing-' + Date.now();
  const div = document.createElement('div');
  div.className = 'message assistant';
  div.id = id;
  div.innerHTML = `
    <div class="msg-avatar">${appState.mode === 'fishing' ? '🎣' : '🦌'}</div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return id;
}

function removeTyping(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

function formatMessage(text) {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,3} (.+)$/gm, '<div class="msg-section-title">$1</div>')
    .replace(/^[•\-\*] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/gs, m => `<ul>${m}</ul>`)
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^(?!<)(.+)$/gm, '<p>$1</p>')
    .replace(/<p><\/p>/g, '');
}

/* ===== CLAUDE API ===== */
async function callClaude(userMessage) {
  const systemPrompt = buildSystemPrompt();

  const messages = [
    ...appState.conversationHistory.slice(-8),
    { role: 'user', content: userMessage }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': appState.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-8',
      max_tokens: 1024,
      system: systemPrompt,
      messages
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

function buildSystemPrompt() {
  const mode = appState.mode;
  const loc = appState.locationName || 'an unknown location';
  const lat = appState.lat ? appState.lat.toFixed(4) : null;
  const lon = appState.lon ? appState.lon.toFixed(4) : null;
  const coords = lat ? `(${lat}, ${lon})` : 'not available';

  const water = appState.waterData;
  const weather = appState.weatherData;

  const waterSummary = mode === 'fishing' ? `
LIVE WATER DATA (USGS):
- Flow rate: ${water.flow ? water.flow + ' cfs' : 'not available'}
- Gauge height: ${water.height ? water.height + ' ft' : 'not available'}
- Water temperature: ${water.waterTemp ? cToF(parseFloat(water.waterTemp)).toFixed(1) + '°F' : 'not available'}
- Water clarity: ${document.getElementById('waterClarity').textContent}
- Gauge station: ${water.siteName || 'nearest stream gauge'}
` : `
TERRAIN CONTEXT:
- GPS coordinates: ${coords}
- Region: ${loc}
`;

  const weatherSummary = `
LIVE WEATHER (NOAA):
- Temperature: ${weather.temp ? weather.temp + '°F' : 'not available'}
- Wind: ${weather.windSpeed || '—'} ${weather.windDir || ''}
- Conditions: ${weather.shortForecast || 'not available'}
- Barometric pressure trend: ${document.getElementById('pressure').textContent}
`;

  if (mode === 'fishing') {
    return `You are an expert fishing guide and naturalist. You have deep knowledge of fly fishing, lure fishing, fish behavior, entomology, reading water, and aquatic ecology.

USER LOCATION: ${loc} ${coords}
${waterSummary}${weatherSummary}

Your job: Give specific, actionable fishing advice based on these live conditions. Be direct — tell the angler EXACTLY what to do, where to go, what to use, and when. Don't give vague suggestions.

Format your responses clearly with short paragraphs. Use **bold** for key action items. When recommending flies or lures, give specific names and sizes. When referencing water position, use directional language (upstream, downstream, river left/right, near structure). Reference the live data when it influences your advice.

Keep responses focused and practical — the angler is standing at the water right now.`;
  } else {
    return `You are an expert hunting guide, wildlife biologist, and outdoorsman with decades of field experience. You understand animal behavior, habitat, sign reading, wind thermals, calling sequences, and hunting tactics across all major North American game species.

USER LOCATION: ${loc} ${coords}
${weatherSummary}
TERRAIN: Coordinates suggest ${lat ? 'GPS position confirmed' : 'no GPS lock — ask the user for their general location or state'}.

Your job: Give specific, actionable hunting advice based on these live conditions. Tell the hunter EXACTLY where to go, when to be there, how to approach, what calls or scents to use, and what gear matters most for today's conditions.

Format your responses clearly. Use **bold** for key action items. Reference the weather data when it influences animal movement. Give specific times for morning/evening movement windows. If you need more information about species, terrain, or the user's setup — ask one focused question.

Keep responses tactical and field-ready.`;
  }
}