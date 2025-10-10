const state = {
  token: null,
  user: null,
  currentDeviceHistory: []
};

const select = (selector, scope = document) => scope.querySelector(selector);
const selectAll = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

const toggleHidden = (element, hidden) => {
  if (!element) return;
  element.classList.toggle('hidden', hidden);
};

const apiFetch = async (path, options = {}) => {
  const headers = options.headers || {};
  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body:
      options.body instanceof FormData
        ? options.body
        : options.body
        ? JSON.stringify(options.body)
        : undefined
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Error de servidor');
  }
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
};

const showDashboard = () => {
  toggleHidden(select('#login-section'), true);
  toggleHidden(select('#dashboard'), false);
  if (state.user?.role === 'admin') {
    selectAll('.admin-only').forEach((el) => {
      el.classList.remove('admin-only');
      el.classList.remove('hidden');
    });
  }
  loadAllSections();
};

const loadAllSections = () => {
  loadOverview();
  loadLocations();
  loadCategories();
  loadDevices();
  if (state.user?.role === 'admin') {
    loadGateways();
    loadMessages();
  }
  loadAlarms();
  loadAlarmEvents();
  loadGroups();
};

const renderCards = (container, items, build) => {
  container.innerHTML = '';
  if (!items || !items.length) {
    container.innerHTML = '<p>No hay datos disponibles.</p>';
    return;
  }
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'card-item';
    card.innerHTML = build(item);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
};

const loadOverview = async () => {
  try {
    const data = await apiFetch('/user/devices-by-location');
    const container = select('#overview-content');
    renderCards(container, data, (item) => {
      const devices = (item.devices || [])
        .map(
          (device) => `
            <li>
              <strong>${device.name || device.ble_mac}</strong>
              <span>Último visto: ${device.last_seen ? new Date(device.last_seen).toLocaleString() : '—'}</span>
              <span>Batería: ${device.battery_voltage ?? '—'} V</span>
            </li>
          `
        )
        .join('');
      const photo = item.location_photo
        ? `<img src="${item.location_photo}" alt="${item.location_name}" />`
        : '';
      return `
        ${photo}
        <h3>${item.location_name || 'Sin lugar'}</h3>
        <ul>${devices}</ul>
      `;
    });
  } catch (err) {
    console.error(err);
  }
};

const loadLocations = async () => {
  try {
    const locations = await apiFetch('/user/locations');
    const container = select('#locations-list');
    renderCards(container, locations, (location) => {
      const photo = location.photo_url
        ? `<img src="${location.photo_url}" alt="${location.name}" />`
        : '';
      return `
        ${photo}
        <h3>${location.name}</h3>
        <p>${location.description || 'Sin descripción'}</p>
        <p>ID: ${location.id}</p>
      `;
    });
  } catch (err) {
    console.error(err);
  }
};

const loadCategories = async () => {
  try {
    const categories = await apiFetch('/user/categories');
    const container = select('#categories-list');
    renderCards(container, categories, (category) => {
      const photo = category.photo_url
        ? `<img src="${category.photo_url}" alt="${category.name}" />`
        : '';
      return `
        ${photo}
        <h3>${category.name}</h3>
        <p>${category.description || 'Sin descripción'}</p>
        <p>ID: ${category.id}</p>
      `;
    });
  } catch (err) {
    console.error(err);
  }
};

const loadDevices = async () => {
  try {
    const devices = await apiFetch('/user/devices');
    const container = select('#devices-list');
    renderCards(container, devices, (device) => `
      <h3>${device.name || device.ble_mac}</h3>
      <p>MAC: ${device.ble_mac}</p>
      <p>Categoría: ${device.category_name || '—'}</p>
      <p>ID: ${device.id}</p>
    `);
  } catch (err) {
    console.error(err);
  }
};

const loadGateways = async () => {
  try {
    const endpoint = state.user?.role === 'admin' ? '/admin/gateways' : '/user/gateways';
    const gateways = await apiFetch(endpoint);
    const container = select('#gateways-list');
    renderCards(container, gateways, (gateway) => `
      <h3>${gateway.name}</h3>
      <p>MAC: ${gateway.mac}</p>
      <p>Propietario: ${gateway.owner || state.user?.username}</p>
      <p>Lugar: ${gateway.location_name || 'No asignado'}</p>
      <p>ID: ${gateway.id}</p>
    `);
  } catch (err) {
    console.error(err);
  }
};

const loadMessages = async () => {
  try {
    const messages = await apiFetch('/admin/messages');
    const container = select('#messages-list');
    container.innerHTML = '';
    messages.forEach((msg) => {
      const pre = document.createElement('pre');
      pre.textContent = `[${new Date(msg.received_at).toLocaleString()}] ${msg.topic}\n${JSON.stringify(
        msg.payload,
        null,
        2
      )}`;
      container.appendChild(pre);
    });
  } catch (err) {
    console.error(err);
  }
};

const loadHistory = async (deviceId) => {
  try {
    const history = await apiFetch(`/user/devices/${deviceId}/history`);
    state.currentDeviceHistory = history;
    const container = select('#history-table');
    if (!history.length) {
      container.innerHTML = '<p>No hay histórico disponible.</p>';
      return;
    }
    const header = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Gateway</th>
            <th>Lugar</th>
            <th>RSSI</th>
            <th>Batería (V)</th>
            <th>Temp (°C)</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = history
      .map(
        (row) => `
          <tr>
            <td>${new Date(row.seen_at).toLocaleString()}</td>
            <td>${row.gateway_name || '—'}</td>
            <td>${row.location_name || '—'}</td>
            <td>${row.rssi ?? '—'}</td>
            <td>${row.battery_voltage ?? '—'}</td>
            <td>${row.temperature ?? '—'}</td>
            <td>${row.status || '—'}</td>
          </tr>
        `
      )
      .join('');
    container.innerHTML = `${header}${rows}</tbody></table>`;
  } catch (err) {
    console.error(err);
  }
};

const loadAlarms = async () => {
  try {
    const alarms = await apiFetch('/user/alarms');
    const container = select('#alarms-list');
    renderCards(container, alarms, (alarm) => `
      <h3>${alarm.name}</h3>
      <p>${alarm.description || 'Sin descripción'}</p>
      <p>Umbral: ${alarm.threshold_seconds} s</p>
      <p>ID: ${alarm.id}</p>
      <button data-resolve="${alarm.id}">Resolver eventos</button>
    `);
    selectAll('#alarms-list [data-resolve]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await apiFetch(`/user/alarms/${button.dataset.resolve}/resolve`, { method: 'POST', body: {} });
          loadAlarmEvents();
        } catch (err) {
          console.error(err);
        }
      });
    });
  } catch (err) {
    console.error(err);
  }
};

const loadAlarmEvents = async () => {
  try {
    const events = await apiFetch('/user/alarm-events');
    const container = select('#alarm-events');
    if (!events.length) {
      container.innerHTML = '<p>No hay alarmas activas.</p>';
      return;
    }
    const header = `
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Alarma</th>
            <th>Dispositivo</th>
            <th>Estado</th>
            <th>Resuelta</th>
          </tr>
        </thead>
        <tbody>
    `;
    const rows = events
      .map(
        (event) => `
          <tr>
            <td>${new Date(event.triggered_at).toLocaleString()}</td>
            <td>${event.alarm_name}</td>
            <td>${event.device_name}</td>
            <td>${event.status}</td>
            <td>${event.resolved_at ? new Date(event.resolved_at).toLocaleString() : '—'}</td>
          </tr>
        `
      )
      .join('');
    container.innerHTML = `${header}${rows}</tbody></table>`;
  } catch (err) {
    console.error(err);
  }
};

const loadGroups = async () => {
  try {
    const groups = await apiFetch('/user/user-groups');
    const container = select('#groups-list');
    renderCards(container, groups, (group) => `
      <h3>${group.name}</h3>
      <p>ID: ${group.id}</p>
    `);
  } catch (err) {
    console.warn('Gestión de grupos requiere implementación adicional en API.', err);
  }
};

// Event listeners
select('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const username = select('#username').value.trim();
  const password = select('#password').value;
  try {
    const response = await apiFetch('/auth/login', { method: 'POST', body: { username, password } });
    state.token = response.token;
    state.user = response.user;
    showDashboard();
  } catch (err) {
    select('#login-error').textContent = 'Acceso denegado. Comprueba tus credenciales.';
    toggleHidden(select('#login-error'), false);
    console.error(err);
  }
});

const bindDialog = (triggerSelector, dialogSelector, onSubmit) => {
  const trigger = select(triggerSelector);
  const dialog = select(dialogSelector);
  if (!trigger || !dialog) return;
  trigger.addEventListener('click', () => {
    dialog.reset?.();
    toggleHidden(dialog, false);
  });
  selectAll('[data-close]', dialog).forEach((button) =>
    button.addEventListener('click', () => toggleHidden(dialog, true))
  );
  dialog.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(dialog);
    const body = Object.fromEntries(formData.entries());
    try {
      await onSubmit(body);
      toggleHidden(dialog, true);
      loadAllSections();
    } catch (err) {
      console.error(err);
      alert('No se pudo guardar la información');
    }
  });
};

bindDialog('#add-location-btn', '#location-form', (body) => apiFetch('/user/locations', { method: 'POST', body }));
bindDialog('#add-category-btn', '#category-form', (body) => apiFetch('/user/categories', { method: 'POST', body }));
bindDialog('#add-device-btn', '#device-form', (body) => {
  if (body.category_id === '') delete body.category_id;
  return apiFetch('/user/devices/assign', { method: 'POST', body });
});
bindDialog('#assign-device-category-btn', '#device-category-form', (body) => {
  const deviceId = body.device_id;
  const payload = { category_id: Number(body.category_id) };
  return apiFetch(`/user/devices/${deviceId}/category`, { method: 'POST', body: payload });
});
bindDialog('#add-gateway-btn', '#gateway-form', (body) => apiFetch('/admin/gateways', { method: 'POST', body }));
bindDialog('#assign-location-btn', '#gateway-location-form', (body) => {
  const gatewayId = body.gateway_id;
  const payload = { location_id: Number(body.location_id) };
  return apiFetch(`/user/gateways/${gatewayId}/assign-location`, { method: 'POST', body: payload });
});
bindDialog('#add-alarm-btn', '#alarm-form', (body) => {
  body.device_ids = body.device_ids
    .split(',')
    .map((id) => Number(id.trim()))
    .filter(Boolean);
  body.threshold_seconds = Number(body.threshold_seconds);
  return apiFetch('/user/alarms', { method: 'POST', body });
});
bindDialog('#add-group-btn', '#group-form', (body) => apiFetch('/user/user-groups', { method: 'POST', body }));
bindDialog('#assign-group-btn', '#group-member-form', (body) => {
  const groupId = body.group_id;
  const payload = { user_id: Number(body.user_id), can_manage_alarms: body.can_manage_alarms === 'true' };
  return apiFetch(`/user/user-groups/${groupId}/members`, { method: 'POST', body: payload });
});

select('#history-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const id = Number(event.target.device_id.value);
  if (!id) return;
  loadHistory(id);
});

selectAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    const target = button.dataset.target;
    selectAll('.tabs button').forEach((btn) => btn.classList.remove('active'));
    button.classList.add('active');
    selectAll('.panel').forEach((panel) => toggleHidden(panel, panel.id !== target));
    if (target === 'groups') {
      loadGroups();
    }
    if (target === 'messages' && state.user?.role === 'admin') {
      loadMessages();
    }
  });
});


document.addEventListener('DOMContentLoaded', () => {
  selectAll('.tabs button')[0]?.click();
});
