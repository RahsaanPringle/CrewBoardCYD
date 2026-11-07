/* global bootstrap */
(function ($) {
  'use strict';

  const DEFAULT_ROLES = ['Owner', 'Crew Lead', 'Crew Member', 'Equipment Operator', 'Trainee'];
  const OWNER_ROLE = 'Owner';
  const TILE_SIZE = 256;
  const state = {
    session: null, roster: [], customers: [], locations: [], schedule: [], messages: [], accounts: [],
    scheduleView: 'calendar', calendarMonth: null, selectedDay: ''
  };
  const modal = new bootstrap.Modal(document.getElementById('record-modal'));
  let editing = { kind: '', id: '', parentId: '' };
  let initialFieldValues = {};
  let editorTrigger = null;
  let editorTriggerMatch = null;

  function escapeHtml(value) { return $('<div>').text(value == null ? '' : String(value)).html().replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
  function makeId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function byId(kind, id) { return state[kind].find((item) => item.id === id); }
  function locationName(id) { const item = byId('locations', id); return item ? item.name : 'Unknown location'; }
  function employeeName(id) { const item = byId('roster', id); return item ? item.name : 'Unknown employee'; }
  function accountFor(employee) { return state.accounts.find((account) => account.employeeId === employee.id || (!account.employeeId && account.username === employee.username)); }
  function empty(message) { return '<div class="empty-state">' + escapeHtml(message) + '</div>'; }
  function isAdmin() { return !!(state.session && state.session.isAdmin); }
  function roles() { return (state.session && state.session.roles && state.session.roles.length) ? state.session.roles : DEFAULT_ROLES; }
  function hasCoordinates(location) {
    return location.latitude !== null && location.latitude !== '' && location.longitude !== null && location.longitude !== '' &&
      Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
  }
  function pad2(value) { return String(value).padStart(2, '0'); }
  function dateKey(date) { return String(date.getFullYear()).padStart(4, '0') + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()); }
  function localDate(year, month, day) {
    const date = new Date(0);
    date.setHours(12, 0, 0, 0);
    date.setFullYear(year, month, day);
    return date;
  }
  function scheduleDate(value) {
    const parts = value.split('-').map(Number);
    return localDate(parts[0], parts[1] - 1, parts[2]);
  }
  function scheduleDateLabel(value) {
    return scheduleDate(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  function localTimestamp() { const now = new Date(); return dateKey(now) + 'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()); }

  function showAlert(message, type) {
    $('#alert-area').html('<div class="alert alert-' + (type || 'danger') + ' alert-dismissible fade show" role="alert">' + escapeHtml(message) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>');
  }
  function apiError(xhr, fallback) { showAlert((xhr && xhr.responseJSON && xhr.responseJSON.error) || fallback); }

  function api(path, options) {
    const settings = $.extend(true, {
      url: '/api/v1/' + path,
      dataType: 'json',
      cache: false,
      headers: { 'X-CrewBoard-Request': '1' }
    }, options || {});
    if (settings.data && typeof settings.data !== 'string') {
      settings.data = JSON.stringify(settings.data);
      settings.contentType = 'application/json; charset=utf-8';
    }
    return $.ajax(settings);
  }

  function formatDate(value) {
    if (!value) return { month: '', day: '', full: 'Unscheduled' };
    const date = new Date(value.length > 10 ? value : value + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return { month: '', day: '', full: value };
    const full = date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    return {
      month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString(undefined, { day: '2-digit' }),
      full: value.length > 10 ? full + ' ' + date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : full
    };
  }

  function actionButtons(kind, id) {
    if (!isAdmin()) return '';
    return '<span class="record-actions"><button class="btn btn-sm btn-outline-primary edit-record" data-kind="' + kind + '" data-id="' + escapeHtml(id) + '">Edit</button> <button class="btn btn-sm btn-outline-danger delete-record" data-kind="' + kind + '" data-id="' + escapeHtml(id) + '">Delete</button></span>';
  }

  // ---------- Roster ----------

  function canEditOwnProfile(employee) {
    return !isAdmin() && state.session && state.session.employeeId === employee.id && employee.role !== OWNER_ROLE;
  }

  function renderRoster() {
    const rows = state.roster.map((employee) => {
      const contact = [employee.phone, employee.email].filter(Boolean).map(escapeHtml).join('<br>') || '<span class="text-secondary">—</span>';
      const account = accountFor(employee);
      const loginUsername = account ? account.username : employee.username;
      const roleBadge = employee.role ? '<span class="badge ' + (employee.role === OWNER_ROLE ? 'text-bg-warning' : 'text-bg-light border') + '">' + escapeHtml(employee.role) + '</span>' : '<span class="text-secondary">—</span>';
      const actions = isAdmin() ? actionButtons('roster', employee.id) : (canEditOwnProfile(employee) ? '<button class="btn btn-sm btn-outline-primary edit-profile">Edit my details</button>' : '');
      return '<tr><td class="fw-semibold">' + escapeHtml(employee.name) + '</td><td>' + roleBadge + '</td><td>' + contact + '</td><td>' + escapeHtml(employee.birthday || '—') + '</td><td>' + (loginUsername ? '<span class="badge text-bg-info">' + escapeHtml(loginUsername) + '</span>' : '<span class="text-secondary">None</span>') + '</td><td><span class="badge ' + (employee.active ? 'text-bg-success' : 'text-bg-secondary') + '">' + (employee.active ? 'Active' : 'Inactive') + '</span></td><td class="text-end">' + actions + '</td></tr>';
    });
    $('#roster-list').html(rows.length ? rows.join('') : '<tr><td colspan="7">' + empty('No employees have been added.') + '</td></tr>');
  }

  function renderCustomers() {
    const cards = state.customers.map((customer) => {
      const locations = (customer.locationIds || []).map(locationName).join(', ') || 'No locations linked';
      return '<article class="card shadow-sm"><div class="card-body"><div class="d-flex justify-content-between gap-2"><h3 class="h5">' +
        escapeHtml(customer.name) + '</h3>' + actionButtons('customers', customer.id) + '</div><p class="mb-0">' + escapeHtml(locations) + '</p></div></article>';
    });
    $('#customers-list').html(cards.length ? cards.join('') : empty('No customers have been added.'));
  }

  function normalizeRole(role) {
    if (!role || roles().includes(role)) return role || '';
    return role === 'Crew' ? 'Crew Member' : '';
  }

  // ---------- Schedule ----------

  function jobCard(job) {
    const date = formatDate(job.date);
    const crew = (job.crewIds || []).map(employeeName).join(', ') || 'Unassigned';
    return '<div class="col-12"><article class="card shadow-sm"><div class="card-body d-flex flex-column flex-sm-row gap-3"><div class="job-date"><small>' + escapeHtml(date.month) + '</small><strong>' + escapeHtml(date.day) + '</strong></div><div class="flex-grow-1"><div class="d-flex flex-wrap justify-content-between gap-2"><div><h4 class="h5 mb-1">' + escapeHtml(job.title) + '</h4><p class="text-secondary mb-2">' + escapeHtml(date.full) + ' · ' + escapeHtml(job.startTime || '') + (job.endTime ? '–' + escapeHtml(job.endTime) : '') + '</p></div>' + actionButtons('schedule', job.id) + '</div><p class="mb-1"><strong>Location:</strong> ' + escapeHtml(locationName(job.locationId)) + '</p><p class="mb-1"><strong>Crew:</strong> ' + escapeHtml(crew) + '</p>' + (job.notes ? '<p class="mb-0 mt-2">' + escapeHtml(job.notes) + '</p>' : '') + '</div></div></article></div>';
  }

  function sortedJobs() {
    return state.schedule.slice().sort((a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      String(a.startTime || '').localeCompare(String(b.startTime || '')) ||
      String(a.title || '').localeCompare(String(b.title || '')) ||
      String(a.id || '').localeCompare(String(b.id || '')));
  }

  function renderSchedule() {
    const list = state.scheduleView === 'list';
    if (list && !state.selectedDay) state.selectedDay = dateKey(new Date());
    $('#schedule-list').toggleClass('d-none', !list);
    $('#schedule-calendar').toggleClass('d-none', list);
    $('.schedule-view').each(function () { $(this).toggleClass('active', $(this).data('view') === state.scheduleView).attr('aria-pressed', $(this).data('view') === state.scheduleView); });
    if (!list) { renderCalendar(); return; }
    const label = scheduleDateLabel(state.selectedDay);
    const cards = sortedJobs().filter((job) => job.date === state.selectedDay).map(jobCard);
    $('#schedule-list-heading').text('Jobs for ' + label);
    $('#schedule-list-cards').html(cards.length ? cards.join('') : '<div class="col-12">' + empty('No jobs are scheduled for ' + label + '.') + '</div>');
  }

  function renderCalendar() {
    const today = new Date();
    if (!state.calendarMonth) state.calendarMonth = localDate(today.getFullYear(), today.getMonth(), 1);
    const month = state.calendarMonth;
    const todayKey = dateKey(today);
    const jobsByDay = new Map();
    sortedJobs().forEach((job) => {
      const jobs = jobsByDay.get(job.date) || [];
      jobs.push(job);
      jobsByDay.set(job.date, jobs);
    });

    const weekdays = [];
    for (let i = 0; i < 7; i += 1) weekdays.push('<div class="calendar-weekday">' + escapeHtml(localDate(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' })) + '</div>');
    const cells = [];
    for (let i = 0; i < month.getDay(); i += 1) cells.push('<div class="calendar-day calendar-blank" aria-hidden="true"></div>');
    const daysInMonth = localDate(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dateKey(localDate(month.getFullYear(), month.getMonth(), day));
      const jobs = jobsByDay.get(key) || [];
      const chips = jobs.slice(0, 3).map((job) => '<span class="calendar-job" title="' + escapeHtml(job.title + ' · ' + locationName(job.locationId)) + '">' + escapeHtml((job.startTime || '') + ' ' + job.title) + '</span>').join('') + (jobs.length > 3 ? '<span class="calendar-more">+' + (jobs.length - 3) + ' more</span>' : '');
      const selected = key === state.selectedDay;
      const classes = 'calendar-day' + (key === todayKey ? ' is-today' : '') + (selected ? ' is-selected' : '') + (jobs.length ? ' has-jobs' : '');
      const label = scheduleDateLabel(key) + ', ' + jobs.length + ' scheduled ' + (jobs.length === 1 ? 'job' : 'jobs');
      cells.push('<button type="button" class="' + classes + '" data-date="' + key + '" aria-label="' + escapeHtml(label) +
        '" aria-pressed="' + selected + '"' + (key === todayKey ? ' aria-current="date"' : '') + '><span class="calendar-number">' + day + '</span>' +
        (jobs.length ? '<span class="calendar-count">' + jobs.length + '</span>' : '') + '<span class="calendar-jobs">' + chips + '</span></button>');
    }
    const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstMonth = month.getFullYear() === 1 && month.getMonth() === 0;
    const lastMonth = month.getFullYear() === 9999 && month.getMonth() === 11;
    $('#schedule-calendar').html(
      '<div class="card shadow-sm calendar-card"><div class="card-body">' +
      '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><h3 class="h5 mb-0">' + escapeHtml(label) + '</h3><div class="btn-group" role="group" aria-label="Change month"><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="-1" aria-label="Previous month"' + (firstMonth ? ' disabled' : '') + '>‹</button><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="0" aria-label="Show current month without changing the selected date">Current month</button><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="1" aria-label="Next month"' + (lastMonth ? ' disabled' : '') + '>›</button></div></div>' +
      '<p class="small text-secondary mb-2">Today is filled; the selected date is outlined.</p>' +
      '<div class="calendar-grid">' + weekdays.join('') + cells.join('') + '</div></div></div>'
    );
  }

  function setScheduleView(view) {
    const returningToCalendar = view === 'calendar' && state.scheduleView !== 'calendar';
    if (view === 'list' && !state.selectedDay) state.selectedDay = dateKey(new Date());
    if (returningToCalendar && state.selectedDay) {
      const selected = scheduleDate(state.selectedDay);
      state.calendarMonth = localDate(selected.getFullYear(), selected.getMonth(), 1);
    }
    state.scheduleView = view;
    renderSchedule();
    if (view === 'list') document.getElementById('schedule-list-heading').focus();
    else if (returningToCalendar && state.selectedDay) {
      const selected = document.querySelector('#schedule-calendar [data-date="' + state.selectedDay + '"]');
      if (selected) selected.focus();
    }
  }

  function selectScheduleDay(day) {
    state.selectedDay = day;
    setScheduleView('list');
  }

  function navigateCalendar(step) {
    const today = new Date();
    const month = step === 0 ? localDate(today.getFullYear(), today.getMonth(), 1) :
      localDate(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + step, 1);
    if (month.getFullYear() < 1 || month.getFullYear() > 9999) return;
    state.calendarMonth = month;
    renderCalendar();
    const button = document.querySelector('#schedule-calendar .calendar-nav[data-step="' + step + '"]');
    const fallback = document.querySelector('#schedule-calendar .calendar-nav[data-step="0"]');
    if (button && !button.disabled) button.focus();
    else if (fallback) fallback.focus();
  }

  // ---------- Messages ----------

  function canDeleteMessage(message) { return isAdmin() || (state.session && message.author && message.author === state.session.username); }

  function renderMessagePost(message, childrenByParent, depth) {
    const replies = (childrenByParent[message.id] || []).slice().sort((a, b) => String(a.postedAt).localeCompare(String(b.postedAt)));
    const author = message.author ? '<span class="message-author">' + escapeHtml(message.author) + '</span>' : '<span class="message-author text-secondary">Unknown user</span>';
    const meta = author + ' · ' + escapeHtml(formatDate(message.postedAt).full) + (message.expiresAt ? ' · Expires ' + escapeHtml(formatDate(message.expiresAt).full) : '');
    const buttons = '<div class="message-actions"><button class="btn btn-sm btn-link reply-message" data-id="' + escapeHtml(message.id) + '">Reply</button>' +
      (isAdmin() ? '<button class="btn btn-sm btn-link edit-message" data-id="' + escapeHtml(message.id) + '">Edit</button>' : '') +
      (canDeleteMessage(message) ? '<button class="btn btn-sm btn-link text-danger delete-message" data-id="' + escapeHtml(message.id) + '">Delete</button>' : '') + '</div>';
    const title = message.title ? '<h3 class="' + (depth ? 'h6' : 'h5') + ' mb-1">' + escapeHtml(message.title) + '</h3>' : '';
    const children = replies.map((reply) => renderMessagePost(reply, childrenByParent, depth + 1)).join('');
    return '<div class="message-post' + (depth ? ' message-reply' : '') + (depth > 4 ? ' message-flat' : '') + '">' + title + '<p class="small text-secondary mb-1">' + meta + '</p><p class="mb-1 message-body">' + escapeHtml(message.body).replace(/\n/g, '<br>') + '</p>' + buttons + (children ? '<div class="message-replies">' + children + '</div>' : '') + '</div>';
  }

  function renderMessages() {
    const ids = new Set(state.messages.map((message) => message.id));
    const childrenByParent = {};
    const roots = [];
    state.messages.forEach((message) => {
      if (message.parentId && ids.has(message.parentId)) (childrenByParent[message.parentId] = childrenByParent[message.parentId] || []).push(message);
      else roots.push(message);
    });
    const cards = roots.sort((a, b) => String(b.postedAt).localeCompare(String(a.postedAt))).map((message) => '<div class="col-12"><article class="card shadow-sm"><div class="card-body">' + renderMessagePost(message, childrenByParent, 0) + '</div></article></div>');
    $('#messages-list').html(cards.length ? cards.join('') : '<div class="col-12">' + empty('There are no messages yet. Start the conversation.') + '</div>');
  }

  function reloadMessages() {
    return api('messages').done((messages) => { state.messages = messages; renderMessages(); }).fail((xhr) => apiError(xhr, 'Could not reload messages.'));
  }

  function deleteMessage(id) {
    const replies = state.messages.some((message) => message.parentId === id);
    if (!window.confirm(replies ? 'Delete this message and all of its replies?' : 'Delete this message?')) return;
    api('messages/' + encodeURIComponent(id), { method: 'DELETE' }).done(reloadMessages).fail((xhr) => apiError(xhr, 'Could not delete the message.'));
  }

  // ---------- Locations ----------

  function fullAddress(location) {
    return [location.address, location.city, location.region, location.postalCode].filter(Boolean).join(', ');
  }

  function renderLocations() {
    const cards = state.locations.map((location) => {
      const mapLink = hasCoordinates(location)
        ? '<a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(location.latitude) + '&mlon=' + encodeURIComponent(location.longitude) + '#map=16/' + encodeURIComponent(location.latitude) + '/' + encodeURIComponent(location.longitude) + '">Open street map</a>'
        : '<span class="badge text-bg-warning">Needs latitude and longitude — hidden from map</span>';
      const customers = state.customers.filter((customer) => (customer.locationIds || []).includes(location.id)).map((customer) => customer.name);
      return '<article class="card shadow-sm"><div class="card-body"><div class="d-flex justify-content-between gap-2"><h3 class="h5">' + escapeHtml(location.name) + '</h3>' + actionButtons('locations', location.id) + '</div><p>' + escapeHtml(fullAddress(location)) + '</p>' + (customers.length ? '<p>Customers: ' + escapeHtml(customers.join(', ')) + '</p>' : '') + mapLink + '</div></article>';
    });
    $('#locations-list').html(cards.length ? cards.join('') : empty('No business locations have been added.'));
    renderLocationMap();
  }

  function project(latitude, longitude, zoom) {
    const scale = TILE_SIZE * Math.pow(2, zoom);
    const sine = Math.min(Math.max(Math.sin(latitude * Math.PI / 180), -0.9999), 0.9999);
    return { x: (longitude + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
  }

  function renderLocationMap() {
    const $map = $('#location-map');
    const plotted = state.locations.filter(hasCoordinates);
    const hidden = state.locations.length - plotted.length;
    $('#location-map-note').text(hidden ? hidden + ' location(s) without coordinates are not shown on the map.' : '');
    if (!plotted.length) { $map.html('<div class="map-empty">' + empty('Add latitude and longitude to a location to show it here.') + '</div>'); return; }
    const width = $map.innerWidth(); const height = $map.innerHeight();
    if (!width || !height) return;

    const padding = 48;
    let zoom = 17; let points = [];
    for (; zoom >= 1; zoom -= 1) {
      points = plotted.map((location) => ({ location: location, point: project(Number(location.latitude), Number(location.longitude), zoom) }));
      const xs = points.map((item) => item.point.x); const ys = points.map((item) => item.point.y);
      if (Math.max.apply(null, xs) - Math.min.apply(null, xs) <= width - 2 * padding && Math.max.apply(null, ys) - Math.min.apply(null, ys) <= height - 2 * padding) break;
    }
    zoom = Math.max(zoom, 1);
    const xs = points.map((item) => item.point.x); const ys = points.map((item) => item.point.y);
    const left = (Math.min.apply(null, xs) + Math.max.apply(null, xs)) / 2 - width / 2;
    const top = (Math.min.apply(null, ys) + Math.max.apply(null, ys)) / 2 - height / 2;
    const tileCount = Math.pow(2, zoom);
    const tiles = [];
    for (let tileX = Math.floor(left / TILE_SIZE); tileX <= Math.floor((left + width) / TILE_SIZE); tileX += 1) {
      for (let tileY = Math.floor(top / TILE_SIZE); tileY <= Math.floor((top + height) / TILE_SIZE); tileY += 1) {
        if (tileY < 0 || tileY >= tileCount) continue;
        const wrappedX = ((tileX % tileCount) + tileCount) % tileCount;
        tiles.push('<img class="map-tile" alt="" draggable="false" src="https://tile.openstreetmap.org/' + zoom + '/' + wrappedX + '/' + tileY + '.png" style="left:' + Math.round(tileX * TILE_SIZE - left) + 'px;top:' + Math.round(tileY * TILE_SIZE - top) + 'px">');
      }
    }
    const pins = points.map((item) => {
      const x = (item.point.x - left).toFixed(1); const y = (item.point.y - top).toFixed(1);
      const jobs = state.schedule.filter((job) => job.locationId === item.location.id).length;
      const customers = state.customers.filter((customer) => (customer.locationIds || []).includes(item.location.id)).map((customer) => customer.name);
      const label = item.location.name + (customers.length ? ' (' + customers.join(', ') + ')' : '');
      return '<span class="map-point" style="left:' + x + 'px;top:' + y + 'px" title="' + escapeHtml(label + ': ' + jobs + ' scheduled job(s)') + '">' + jobs + '</span><span class="map-label" style="left:' + x + 'px;top:' + y + 'px">' + escapeHtml(label) + '</span>';
    });
    $map.html(tiles.join('') + pins.join('') + '<div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>');
    // Offline devices keep the grid background when tiles cannot load.
    $map.find('img.map-tile').on('error', function () { $(this).remove(); });
  }

  // ---------- Shared ----------

  function renderAll() {
    $('.admin-only').toggle(isAdmin());
    $('#signed-in-user').text(state.session ? state.session.username + (isAdmin() ? ' · Administrator' : ' · Staff') : '');
    renderRoster(); renderCustomers(); renderSchedule(); renderMessages(); renderLocations();
  }

  function validCalendarDate(value, yearOptional) {
    const match = /^(?:(\d{4})-)?(\d{2})-(\d{2})$/.exec(value);
    if (!match || (!yearOptional && !match[1])) return false;
    const year = match[1] ? Number(match[1]) : 2000;
    const month = Number(match[2]); const day = Number(match[3]);
    if (!year || month < 1 || month > 12) return false;
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= days[month - 1];
  }

  function validTime(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  }

  function field(name, label, type, value, options) {
    const settings = options || {};
    const id = 'field-' + name;
    const original = value == null ? '' : String(value);
    const legacy = original && ((type === 'date' && !validCalendarDate(original, false)) ||
      (type === 'time' && !validTime(original)));
    const help = legacy ? 'This saved value is not a valid ' + (type === 'date' ? 'date. Correct it as YYYY-MM-DD' : 'time. Correct it as HH:MM') + ' or clear it if optional.' : settings.help;
    const describedBy = [settings.describedBy, help ? id + '-help' : ''].filter(Boolean).join(' ');
    const attributes = [
      ['maxlength', settings.maxlength], ['minlength', settings.minlength],
      ['autocomplete', settings.autocomplete], ['inputmode', legacy ? 'text' : settings.inputmode],
      ['pattern', legacy ? (type === 'date' ? '[0-9]{4}-[0-9]{2}-[0-9]{2}' : '[0-9]{2}:[0-9]{2}') : settings.pattern],
      ['min', legacy ? null : settings.min], ['max', legacy ? null : settings.max],
      ['step', settings.step], ['placeholder', settings.placeholder], ['aria-describedby', describedBy || null],
      ['data-legacy-format', legacy ? type : null]
    ].filter((entry) => entry[1] != null).map((entry) => ' ' + entry[0] + '="' + escapeHtml(entry[1]) + '"').join('');
    const inputValue = type === 'password' ? '' : ' value="' + escapeHtml(original) + '"';
    const input = '<input class="form-control" id="' + escapeHtml(id) + '" name="' + escapeHtml(name) + '" type="' +
      (legacy ? 'text' : escapeHtml(type || 'text')) + '"' + inputValue + (settings.required ? ' required' : '') + attributes + '>';
    const control = settings.signToggle ? '<div class="input-group">' + input +
      '<button class="btn btn-outline-secondary px-3 toggle-coordinate-sign" type="button" data-target="' + escapeHtml(id) +
      '" aria-controls="' + escapeHtml(id) + '" aria-label="Change the sign of ' + escapeHtml(label.toLowerCase()) + '">+/-</button></div>' : input;
    return '<div class="mb-3"><label class="form-label" for="' + escapeHtml(id) + '">' + escapeHtml(label) + '</label>' + control +
      (help ? '<div id="' + escapeHtml(id) + '-help" class="form-text">' + escapeHtml(help) + '</div>' : '') + '</div>';
  }

  function contactFields(record, ownProfile) {
    return '<div class="row"><div class="col-md-6">' + field('phone', 'Phone (optional)', 'tel', record.phone, { maxlength: 30, autocomplete: ownProfile ? 'tel' : 'off' }) + '</div><div class="col-md-6">' + field('email', 'Email (optional)', 'email', record.email, { maxlength: 100, autocomplete: ownProfile ? 'email' : 'off' }) + '</div></div>' +
      field('birthday', 'Birthday (optional)', 'text', record.birthday, { maxlength: 10, autocomplete: 'off', inputmode: 'text', pattern: '([0-9]{4}-)?[0-9]{2}-[0-9]{2}', help: 'Enter MM-DD or YYYY-MM-DD. The year is optional; for example, 02-29 or 2000-02-29.' }) +
      '<div class="row"><div class="col-md-6">' + field('emergencyContactName', 'Emergency contact name (optional)', 'text', record.emergencyContactName, { maxlength: 80, autocomplete: 'off' }) + '</div><div class="col-md-6">' + field('emergencyContactPhone', 'Emergency contact phone (optional)', 'tel', record.emergencyContactPhone, { maxlength: 30, autocomplete: 'off' }) + '</div></div>';
  }

  function roleSelect(current) {
    const options = roles().map((role) => '<option value="' + escapeHtml(role) + '" ' + (normalizeRole(current) === role ? 'selected' : '') + '>' + escapeHtml(role) + '</option>').join('');
    const note = current && !roles().includes(current) ? '<div id="role-help" class="form-text text-warning-emphasis">The previous role "' + escapeHtml(current) + '" is not in the defined role list. Choose a replacement.</div>' : '';
    return '<div class="mb-3"><label class="form-label" for="field-role">Business role</label><select class="form-select" id="field-role" name="role"' + (note ? ' aria-describedby="role-help"' : '') + '><option value="">No role</option>' + options + '</select>' + note + '</div>';
  }

  function showInvalid(control) {
    const errorId = control.id + '-error';
    let feedback = document.getElementById(errorId);
    if (!feedback) {
      feedback = document.createElement('div');
      feedback.id = errorId;
      feedback.className = 'invalid-feedback';
      if (control.parentElement.classList.contains('input-group')) control.parentElement.appendChild(feedback);
      else control.insertAdjacentElement('afterend', feedback);
    }
    feedback.textContent = control.validationMessage;
    const descriptions = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
    if (!descriptions.includes(errorId)) descriptions.push(errorId);
    control.setAttribute('aria-describedby', descriptions.join(' '));
    control.setAttribute('aria-invalid', 'true');
    control.classList.add('is-invalid');
  }

  function clearInvalid(control) {
    const errorId = control.id + '-error';
    const feedback = document.getElementById(errorId);
    if (feedback) feedback.remove();
    const descriptions = (control.getAttribute('aria-describedby') || '').split(/\s+/).filter((id) => id && id !== errorId);
    if (descriptions.length) control.setAttribute('aria-describedby', descriptions.join(' '));
    else control.removeAttribute('aria-describedby');
    control.removeAttribute('aria-invalid');
    control.classList.remove('is-invalid');
  }

  function updateFormConstraints() {
    const form = document.getElementById('record-form');
    const username = form.querySelector('#field-username');
    const password = form.querySelector('#field-password');
    if (username && password) password.required = !!username.value.trim() && !editing.hasAccount;
    const start = form.querySelector('#field-startTime');
    const end = form.querySelector('#field-endTime');
    if (end && end.type === 'time') {
      if (start && validTime(start.value)) end.min = start.value;
      else end.removeAttribute('min');
    }
    form.querySelectorAll('input, select, textarea').forEach((control) => {
      let message = '';
      if (control.required && control.type !== 'password' && control.value && !control.value.trim()) message = 'Enter a value instead of only spaces.';
      if (control.id === 'field-birthday' && control.value && !validCalendarDate(control.value, true)) {
        message = 'Enter a valid birthday as MM-DD or YYYY-MM-DD.';
      }
      if (control.dataset.legacyFormat && control.value &&
          !(control.dataset.legacyFormat === 'date' ? validCalendarDate(control.value, false) : validTime(control.value))) {
        message = 'Correct the saved value using the format in the help text.';
      }
      if (control === end && start && validTime(start.value) && validTime(end.value) && end.value < start.value) {
        message = 'End time cannot be earlier than start time.';
      }
      if (control.id === 'field-crewIds' && control.selectedOptions.length > 12) message = 'Choose no more than 12 crew members.';
      control.setCustomValidity(message);
      if (control.classList.contains('is-invalid')) {
        if (control.validity.valid) clearInvalid(control);
        else showInvalid(control);
      }
    });
  }

  const recordForm = document.getElementById('record-form');
  recordForm.addEventListener('invalid', (event) => showInvalid(event.target), true);
  recordForm.addEventListener('input', updateFormConstraints);
  recordForm.addEventListener('change', updateFormConstraints);

  function controlValue(control) {
    if (control.type === 'checkbox') return control.checked;
    if (control.multiple) return Array.from(control.selectedOptions, (option) => option.value);
    return control.value;
  }

  function captureInitialValues() {
    initialFieldValues = {};
    recordForm.querySelectorAll('input, select, textarea').forEach((control) => {
      if (control.name) initialFieldValues[control.name] = controlValue(control);
    });
  }

  function fieldValue(name, previous, convert) {
    const control = document.getElementById('field-' + name);
    if (!control) return undefined;
    const current = controlValue(control);
    if (previous && JSON.stringify(current) === JSON.stringify(initialFieldValues[name])) return previous[name];
    return convert ? convert(current) : current;
  }

  function assignField(record, name, previous, convert) {
    const value = fieldValue(name, previous, convert);
    if (value !== undefined) record[name] = value;
  }

  function trim(value) { return value.trim(); }

  function toggleCoordinateSign(control) {
    if (control.validity.badInput) { control.reportValidity(); control.focus(); return; }
    if (!control.value) {
      control.setCustomValidity('Enter a coordinate before changing its sign.');
      control.reportValidity();
      control.focus();
      return;
    }
    control.value = control.value.startsWith('-') ? control.value.slice(1) : '-' + control.value;
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.focus();
  }

  function openEditor(kind, id, parentId, trigger) {
    editorTrigger = trigger;
    editorTriggerMatch = trigger ? {
      action: ['add-record', 'edit-record', 'edit-profile', 'reply-message', 'edit-message'].find((name) => trigger.classList.contains(name)),
      kind: trigger.dataset.kind || '', id: trigger.dataset.id || ''
    } : null;
    editing = { kind: kind, id: id || '', parentId: parentId || '' };
    const record = id ? $.extend(true, {}, byId(kind === 'reply' ? 'messages' : kind, id)) : {};
    let title = ''; let fields = '';
    if (kind === 'roster') {
      title = id ? 'Edit employee' : 'Add employee';
      const account = accountFor(record) || {};
      editing.hasAccount = !!account.username;
      fields = field('name', 'Display name', 'text', record.name, { required: true, maxlength: 60, autocomplete: 'off' }) + roleSelect(record.role) +
        '<hr><h3 class="h6">Contact details</h3>' + contactFields(record, false) +
        '<div class="mb-3"><label class="form-label" for="field-notes">Roster notes (optional)</label><textarea class="form-control" id="field-notes" name="notes" maxlength="300">' + escapeHtml(record.notes || '') + '</textarea></div>' +
        '<hr><h3 class="h6">CrewBoard login</h3><p id="login-help" class="form-text">Both fields may be left blank. A new username needs a password; leave the password blank to keep an existing one. Passwords are stored only in the protected configuration file.</p>' +
        field('username', 'Username (optional)', 'text', account.username || record.username, { maxlength: 40, autocomplete: 'off', pattern: '[^:]*', describedBy: 'login-help' }) +
        field('password', account.username ? 'New password (leave blank to keep current)' : 'Password (required when adding a username)', 'password', '', { maxlength: 100, autocomplete: 'new-password', describedBy: 'login-help' }) +
        '<div class="form-check"><input class="form-check-input" id="field-active" name="active" type="checkbox" ' + (record.active !== false ? 'checked' : '') + '><label class="form-check-label" for="field-active">Active employee</label></div>';
    } else if (kind === 'profile') {
      const employee = byId('roster', state.session.employeeId) || {};
      title = 'Edit my details';
      fields = '<p class="form-text">Only your own contact details can be changed here. Ask the owner to change your name, role, or login.</p>' + contactFields(employee, true);
    } else if (kind === 'customers') {
      title = id ? 'Edit customer' : 'Add customer';
      const selected = record.locationIds || [];
      const options = state.locations.map((item) => '<option value="' + escapeHtml(item.id) + '"' + (selected.includes(item.id) ? ' selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
      fields = field('name', 'Customer name', 'text', record.name, { required: true, maxlength: 80 }) +
        '<div class="mb-3"><label class="form-label" for="field-locationIds">Locations (optional)</label><select class="form-select" id="field-locationIds" name="locationIds" multiple size="5" aria-describedby="customer-locations-help">' + options +
        '</select><div id="customer-locations-help" class="form-text">Choose existing locations. Use Ctrl or Command to select more than one, or use your phone’s selection picker. Add locations in the Locations tab first.</div></div>';
    } else if (kind === 'locations') {
      title = id ? 'Edit location' : 'Add location';
      fields = field('name', 'Location name', 'text', record.name, { required: true, maxlength: 80 }) +
        field('address', 'Street address', 'text', record.address, { required: true, maxlength: 120, autocomplete: 'section-jobsite street-address' }) +
        '<div class="row"><div class="col-md-6">' + field('city', 'City', 'text', record.city, { required: true, maxlength: 60, autocomplete: 'section-jobsite address-level2' }) +
        '</div><div class="col-md-3">' + field('region', 'State/region', 'text', record.region, { maxlength: 30, autocomplete: 'section-jobsite address-level1' }) +
        '</div><div class="col-md-3">' + field('postalCode', 'Postal code', 'text', record.postalCode, { maxlength: 16, autocomplete: 'section-jobsite postal-code' }) +
        '</div></div><div class="row"><div class="col-md-6">' + field('latitude', 'Latitude', 'number', record.latitude, { required: true, step: 'any', min: -90, max: 90, inputmode: 'decimal', describedBy: 'coordinates-help', signToggle: true }) +
        '</div><div class="col-md-6">' + field('longitude', 'Longitude', 'number', record.longitude, { required: true, step: 'any', min: -180, max: 180, inputmode: 'decimal', describedBy: 'coordinates-help', signToggle: true }) +
        '</div></div><p id="coordinates-help" class="form-text">Enter decimal degrees for business job sites. Use negative values for south or west; after entering a value, use +/- to change its sign if your keyboard has no minus key.</p>';
    } else if (kind === 'schedule') {
      title = id ? 'Edit job' : 'Add job';
      const locations = state.locations.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (record.locationId === item.id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
      const crew = state.roster.filter((item) => item.active || (record.crewIds || []).includes(item.id)).map((item) => '<option value="' + escapeHtml(item.id) + '" ' + ((record.crewIds || []).includes(item.id) ? 'selected' : '') + '>' + escapeHtml(item.name) + (item.role ? ' — ' + escapeHtml(item.role) : '') + '</option>').join('');
      const jobDate = id ? record.date : (state.selectedDay || (state.scheduleView === 'calendar' ? dateKey(new Date()) : ''));
      fields = field('title', 'Job title', 'text', record.title, { required: true, maxlength: 80 }) +
        '<div class="row"><div class="col-md-4">' + field('date', 'Date', 'date', jobDate, { required: true, min: '0001-01-01', max: '9999-12-31' }) +
        '</div><div class="col-md-4">' + field('startTime', 'Start time', 'time', record.startTime, { required: true, step: 60 }) +
        '</div><div class="col-md-4">' + field('endTime', 'End time (optional)', 'time', record.endTime, { step: 60, help: 'End time cannot be earlier than start time.' }) +
        '</div></div><div class="mb-3"><label class="form-label" for="field-locationId">Business location</label><select class="form-select" id="field-locationId" name="locationId" required><option value="">Choose a location</option>' + locations +
        '</select></div><div class="mb-3"><label class="form-label" for="field-crewIds">Assigned crew (optional)</label><select class="form-select" id="field-crewIds" name="crewIds" multiple size="5" aria-describedby="crew-help">' + crew +
        '</select><div id="crew-help" class="form-text">Choose up to 12 people. On a computer, use Ctrl or Command to select more than one; on a phone, use the selection picker.</div></div>' +
        '<div class="mb-3"><label class="form-label" for="field-notes">Practical job notes (optional)</label><textarea class="form-control" id="field-notes" name="notes" maxlength="500">' + escapeHtml(record.notes || '') + '</textarea></div>';
    } else if (kind === 'reply') {
      const parent = byId('messages', parentId) || {};
      title = 'Reply to ' + (parent.author || 'message');
      fields = '<blockquote class="message-quote">' + escapeHtml(String(parent.body || '').slice(0, 200)) + '</blockquote><p class="form-text">Posting as <strong>' + escapeHtml(state.session.username) + '</strong>.</p><div class="mb-3"><label class="form-label" for="field-body">Reply</label><textarea class="form-control" id="field-body" name="body" required maxlength="1000"></textarea></div>';
    } else {
      const isReply = !!record.parentId;
      title = id ? 'Edit message' : 'New message';
      fields = (id ? '<p class="form-text">Posted by <strong>' + escapeHtml(record.author || 'Unknown user') + '</strong>.</p>' : '<p class="form-text">Posting as <strong>' + escapeHtml(state.session.username) + '</strong>.</p>') +
        (isReply ? '' : field('title', 'Title', 'text', record.title, { required: true, maxlength: 80 })) +
        '<div class="mb-3"><label class="form-label" for="field-body">Message</label><textarea class="form-control" id="field-body" name="body" required maxlength="1000">' + escapeHtml(record.body || '') + '</textarea></div>' +
        (isAdmin() && !isReply ? field('expiresAt', 'Expiry date (optional)', 'date', record.expiresAt, { min: '0001-01-01', max: '9999-12-31' }) : '');
    }
    $('#record-modal-title').text(title);
    $('#record-form').removeClass('was-validated');
    $('#record-fields').html(fields).scrollTop(0);
    captureInitialValues();
    updateFormConstraints();
    modal.show();
  }

  $('#record-modal').on('shown.bs.modal', function () {
    $('#record-fields').scrollTop(0);
    document.getElementById('record-modal-title').focus({ preventScroll: true });
  }).on('hide.bs.modal', function () {
    if (this.contains(document.activeElement)) document.activeElement.blur();
  }).on('hidden.bs.modal', function () {
    let trigger = editorTrigger;
    // Saving can replace the record's original action button during a re-render.
    if (editorTriggerMatch && (!trigger || !trigger.isConnected)) {
      const match = editorTriggerMatch;
      trigger = Array.from(document.getElementsByClassName(match.action)).find((element) =>
        (element.dataset.kind || '') === match.kind && (element.dataset.id || '') === match.id);
    }
    if ((!trigger || !trigger.getClientRects().length) && editorTriggerMatch &&
        editorTriggerMatch.kind === 'schedule' && state.scheduleView === 'list') {
      trigger = document.getElementById('schedule-list-heading');
    }
    if (!trigger || !trigger.getClientRects().length) trigger = document.querySelector('#section-tabs .active');
    if (trigger) trigger.focus({ preventScroll: true });
    editorTrigger = null;
    editorTriggerMatch = null;
  });

  function contactValues(previous) {
    const contact = {};
    ['phone', 'email', 'birthday', 'emergencyContactName', 'emergencyContactPhone'].forEach((name) =>
      assignField(contact, name, previous, trim));
    return contact;
  }

  function formRecord() {
    const kind = editing.kind;
    const id = editing.id || makeId(kind === 'schedule' ? 'job' : kind === 'locations' ? 'loc' : kind === 'customers' ? 'customer' : 'emp');
    const previous = editing.id ? byId(kind, editing.id) : null;
    const record = $.extend({}, previous || {}, { id: id });
    if (kind === 'roster') {
      ['name', 'username', 'notes'].forEach((name) => assignField(record, name, previous, trim));
      ['role', 'active'].forEach((name) => assignField(record, name, previous));
      return $.extend(record, contactValues(previous), {
        _accountUsername: $('#field-username').val().trim(), _password: $('#field-password').val()
      });
    }
    if (kind === 'customers') {
      assignField(record, 'name', previous, trim);
      assignField(record, 'locationIds', previous);
      if (!record.locationIds) record.locationIds = [];
      return record;
    }
    if (kind === 'locations') {
      ['name', 'address', 'city', 'region', 'postalCode'].forEach((name) => assignField(record, name, previous, trim));
      ['latitude', 'longitude'].forEach((name) => assignField(record, name, previous, Number));
      return record;
    }
    ['title', 'notes'].forEach((name) => assignField(record, name, previous, trim));
    ['date', 'startTime', 'endTime', 'locationId', 'crewIds'].forEach((name) => assignField(record, name, previous));
    return record;
  }

  function saveCollection(kind, collection) {
    if (kind === 'roster') collection = collection.map((employee) => employee.role && !roles().includes(employee.role)
      ? $.extend({}, employee, { role: normalizeRole(employee.role) }) : employee);
    return api(kind, { method: 'PUT', data: collection }).done(() => { state[kind] = collection; renderAll(); }).fail((xhr) => apiError(xhr, 'Could not save changes.'));
  }

  function saveRosterAccount(employee, previousUsername, password) {
    if (!isAdmin()) return $.Deferred().resolve().promise();
    return api('accounts', { method: 'PUT', data: { employeeId: employee.id, username: employee.username || '', password: password || '', previousUsername: previousUsername || '' } })
      .done((accounts) => { state.accounts = accounts; renderAll(); })
      .fail((xhr) => apiError(xhr, 'The roster saved, but the login could not be updated.'));
  }

  function deleteRecord(kind, id) {
    if (kind === 'roster' && state.schedule.some((job) => (job.crewIds || []).includes(id))) { showAlert('This employee is assigned to a job. Remove that assignment first.'); return; }
    if (kind === 'locations' && state.schedule.some((job) => job.locationId === id)) { showAlert('This location is used by a job. Change or remove that job first.'); return; }
    if (kind === 'locations' && state.customers.some((customer) => (customer.locationIds || []).includes(id))) { showAlert('This location is linked to a customer. Remove that link first.'); return; }
    if (!window.confirm('Delete this record?')) return;
    const record = byId(kind, id);
    saveCollection(kind, state[kind].filter((item) => item.id !== id)).done(() => {
      if (kind === 'roster') saveRosterAccount({ id: id, username: '' }, (record && record.username) || '', '');
      if (kind === 'schedule' && state.scheduleView === 'list') {
        const heading = document.getElementById('schedule-list-heading');
        if (heading.getClientRects().length) heading.focus();
      }
    });
  }

  function submitMessage() {
    if (editing.kind === 'reply' || !editing.id) {
      const data = { parentId: editing.parentId, title: editing.kind === 'reply' ? '' : fieldValue('title', null, trim), body: fieldValue('body', null, trim), postedAt: localTimestamp(), expiresAt: fieldValue('expiresAt', null) || '' };
      return api('messages', { method: 'POST', data: data }).done(() => { modal.hide(); reloadMessages(); }).fail((xhr) => apiError(xhr, 'Could not post the message.'));
    }
    // Owner edits re-read the board first so replies posted meanwhile are kept.
    return api('messages').done((latest) => {
      const record = latest.find((item) => item.id === editing.id);
      if (!record) { showAlert('That message was deleted.'); modal.hide(); reloadMessages(); return; }
      assignField(record, 'body', record, trim);
      if (!record.parentId) { assignField(record, 'title', record, trim); assignField(record, 'expiresAt', record); }
      api('messages', { method: 'PUT', data: latest }).done(() => { state.messages = latest; renderMessages(); modal.hide(); }).fail((xhr) => apiError(xhr, 'Could not save the message.'));
    }).fail((xhr) => apiError(xhr, 'Could not load messages.'));
  }

  function submitProfile() {
    return api('profile', { method: 'PUT', data: contactValues(byId('roster', state.session.employeeId)) }).done(() => {
      modal.hide();
      api('roster').done((roster) => { state.roster = roster; renderAll(); });
    }).fail((xhr) => apiError(xhr, 'Could not save your details.'));
  }

  function loadAll() {
    $('#connection-state').removeClass().addClass('badge text-bg-warning').text('Loading');
    const failed = (xhr) => {
      $('#connection-state').removeClass().addClass('badge text-bg-danger').text('Unavailable');
      apiError(xhr, 'CrewBoard could not load data from the CYD.');
    };
    return api('session').done((session) => {
      state.session = session;
      const accountsRequest = session.isAdmin ? api('accounts') : $.Deferred().resolve([]).promise();
      $.when(api('roster'), api('locations'), api('schedule'), api('messages'), accountsRequest, api('customers')).done((roster, locations, schedule, messages, accounts, customers) => {
        const unwrap = (result) => result && result.length === 3 && typeof result[1] === 'string' ? result[0] : result;
        state.roster = unwrap(roster); state.locations = unwrap(locations); state.schedule = unwrap(schedule); state.messages = unwrap(messages); state.accounts = unwrap(accounts) || []; state.customers = unwrap(customers);
        $('#connection-state').removeClass().addClass('badge text-bg-success').text('Local'); renderAll();
      }).fail(failed);
    }).fail(failed);
  }

  $(document).on('click', '.add-record', function () { openEditor($(this).data('kind'), '', '', this); });
  $(document).on('click', '.edit-record', function () { openEditor($(this).data('kind'), $(this).data('id'), '', this); });
  $(document).on('click', '.delete-record', function () { deleteRecord($(this).data('kind'), $(this).data('id')); });
  $(document).on('click', '.edit-profile', function () { openEditor('profile', '', '', this); });
  $(document).on('click', '.reply-message', function () { openEditor('reply', '', $(this).data('id'), this); });
  $(document).on('click', '.edit-message', function () { openEditor('messages', $(this).data('id'), '', this); });
  $(document).on('click', '.delete-message', function () { deleteMessage($(this).data('id')); });
  $(document).on('click', '.toggle-coordinate-sign', function () {
    toggleCoordinateSign(document.getElementById(this.dataset.target));
  });
  $(document).on('click', '.schedule-view', function () { setScheduleView($(this).data('view')); });
  $(document).on('click', '.calendar-day[data-date]', function () { selectScheduleDay($(this).data('date')); });
  $(document).on('click', '.calendar-nav', function () { navigateCalendar(Number($(this).data('step'))); });
  function initializeTabs() {
    const storageKey = 'crewboard.activeTab';
    const buttons = Array.from(document.querySelectorAll('#section-tabs button[data-bs-target]'));
    $('#section-tabs').on('shown.bs.tab', 'button[data-bs-target]', function () {
      try {
        localStorage.setItem(storageKey, this.getAttribute('data-bs-target'));
      } catch (error) {
        console.warn('CrewBoard could not save the active tab in browser storage.');
      }
    });
    let savedTab;
    // localStorage is browser-local and scoped to the origin, not the login or CYD.
    try {
      savedTab = localStorage.getItem(storageKey);
    } catch (error) {
      console.warn('CrewBoard could not read the active tab from browser storage.');
      return;
    }
    const button = buttons.find((item) => item.getAttribute('data-bs-target') === savedTab && !item.disabled);
    if (button && document.getElementById(savedTab.slice(1))) bootstrap.Tab.getOrCreateInstance(button).show();
  }

  $('#section-tabs').on('shown.bs.tab', 'button[data-bs-target="#locations-pane"]', renderLocationMap);
  let resizeTimer = 0;
  $(window).on('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderLocationMap, 200); });

  $('#record-form').on('submit', function (event) {
    event.preventDefault();
    if (editing.kind === 'messages' || editing.kind === 'reply') { submitMessage(); return; }
    if (editing.kind === 'profile') { submitProfile(); return; }
    const record = formRecord(); const collection = state[editing.kind].slice();
    const password = record._password || '';
    const accountUsername = record._accountUsername || '';
    delete record._password;
    delete record._accountUsername;
    const previousRecord = editing.id ? byId(editing.kind, editing.id) : null;
    const index = collection.findIndex((item) => item.id === record.id);
    if (index >= 0) collection[index] = record; else collection.push(record);
    saveCollection(editing.kind, collection).done(() => {
      if (editing.kind === 'roster') {
        saveRosterAccount($.extend({}, record, { username: accountUsername }), (previousRecord && previousRecord.username) || '', password).done(() => modal.hide());
      } else {
        modal.hide();
      }
    });
  });
  function themeLabel(fileName) {
    return fileName.replace(/(\.min)?\.css$/i, '').split(/[-_.]+/).filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

  function loadThemes() {
    const picker = $('#theme-picker');
    const theme = window.CrewBoardTheme;
    if (!theme) return;
    api('themes').done((result) => {
      const files = ((result && result.themes) || []).filter(theme.isValid).sort((a, b) => a.localeCompare(b));
      const site = theme.isValid(result && result.siteTheme) ? result.siteTheme : '';
      const options = [['', 'Site default (' + (site ? themeLabel(site) : 'Classic') + ')'], ['classic', 'CrewBoard classic']]
        .concat(files.map((file) => [file, themeLabel(file)]));
      picker.html(options.map((option) => '<option value="' + escapeHtml(option[0]) + '">' + escapeHtml(option[1]) + '</option>').join(''));
      const stored = theme.stored();
      picker.val(options.some((option) => option[0] === stored) ? stored : '');
      $('#theme-control').removeClass('d-none').addClass('d-flex');
    }).fail(() => $('#theme-control').removeClass('d-flex').addClass('d-none'));
  }

  $('#theme-picker').on('change', function () {
    const picker = $(this);
    window.CrewBoardTheme.choose(picker.val(), (file) => {
      showAlert('The theme "' + file + '" could not be loaded from the CYD.', 'warning');
      picker.val('');
      window.CrewBoardTheme.choose('');
    });
  });
  $('#refresh-all').on('click', loadAll);
  loadThemes();
  loadAll();
  initializeTabs();
})(jQuery);
