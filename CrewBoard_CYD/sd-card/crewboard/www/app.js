/* global bootstrap */
(function ($) {
  'use strict';

  const DEFAULT_ROLES = ['Owner', 'Crew Lead', 'Crew Member', 'Equipment Operator', 'Trainee'];
  const OWNER_ROLE = 'Owner';
  const TILE_SIZE = 256;
  const state = {
    session: null, roster: [], locations: [], schedule: [], messages: [], accounts: [],
    scheduleView: 'list', calendarMonth: null, selectedDay: ''
  };
  const modal = new bootstrap.Modal(document.getElementById('record-modal'));
  let editing = { kind: '', id: '', parentId: '' };

  function escapeHtml(value) { return $('<div>').text(value == null ? '' : String(value)).html(); }
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
  function dateKey(date) { return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate()); }
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

  function normalizeRole(role) {
    if (!role || roles().includes(role)) return role || '';
    return role === 'Crew' ? 'Crew Member' : '';
  }

  // ---------- Schedule ----------

  function jobCard(job) {
    const date = formatDate(job.date);
    const crew = (job.crewIds || []).map(employeeName).join(', ') || 'Unassigned';
    return '<div class="col-12"><article class="card shadow-sm"><div class="card-body d-flex flex-column flex-sm-row gap-3"><div class="job-date"><small>' + escapeHtml(date.month) + '</small><strong>' + escapeHtml(date.day) + '</strong></div><div class="flex-grow-1"><div class="d-flex flex-wrap justify-content-between gap-2"><div><h3 class="h5 mb-1">' + escapeHtml(job.title) + '</h3><p class="text-secondary mb-2">' + escapeHtml(date.full) + ' · ' + escapeHtml(job.startTime || '') + (job.endTime ? '–' + escapeHtml(job.endTime) : '') + '</p></div>' + actionButtons('schedule', job.id) + '</div><p class="mb-1"><strong>Location:</strong> ' + escapeHtml(locationName(job.locationId)) + '</p><p class="mb-1"><strong>Crew:</strong> ' + escapeHtml(crew) + '</p>' + (job.notes ? '<p class="mb-0 mt-2">' + escapeHtml(job.notes) + '</p>' : '') + '</div></div></article></div>';
  }

  function sortedJobs() { return state.schedule.slice().sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)); }

  function renderSchedule() {
    const cards = sortedJobs().map(jobCard);
    $('#schedule-list').html(cards.length ? cards.join('') : '<div class="col-12">' + empty('No jobs have been scheduled.') + '</div>');
    $('#schedule-list').toggleClass('d-none', state.scheduleView !== 'list');
    $('#schedule-calendar').toggleClass('d-none', state.scheduleView !== 'calendar');
    $('.schedule-view').each(function () { $(this).toggleClass('active', $(this).data('view') === state.scheduleView).attr('aria-pressed', $(this).data('view') === state.scheduleView); });
    if (state.scheduleView === 'calendar') renderCalendar();
  }

  function renderCalendar() {
    const today = new Date();
    if (!state.calendarMonth) state.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    if (!state.selectedDay) state.selectedDay = dateKey(today);
    const month = state.calendarMonth;
    const jobsByDay = {};
    sortedJobs().forEach((job) => { (jobsByDay[job.date] = jobsByDay[job.date] || []).push(job); });

    const weekdays = [];
    for (let i = 0; i < 7; i += 1) weekdays.push('<div class="calendar-weekday">' + escapeHtml(new Date(2023, 0, 1 + i).toLocaleDateString(undefined, { weekday: 'short' })) + '</div>');
    const cells = [];
    for (let i = 0; i < month.getDay(); i += 1) cells.push('<div class="calendar-day calendar-blank" aria-hidden="true"></div>');
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = dateKey(new Date(month.getFullYear(), month.getMonth(), day));
      const jobs = jobsByDay[key] || [];
      const chips = jobs.slice(0, 3).map((job) => '<span class="calendar-job" title="' + escapeHtml(job.title + ' · ' + locationName(job.locationId)) + '">' + escapeHtml((job.startTime || '') + ' ' + job.title) + '</span>').join('') + (jobs.length > 3 ? '<span class="calendar-more">+' + (jobs.length - 3) + ' more</span>' : '');
      const classes = 'calendar-day' + (key === dateKey(today) ? ' is-today' : '') + (key === state.selectedDay ? ' is-selected' : '') + (jobs.length ? ' has-jobs' : '');
      cells.push('<button type="button" class="' + classes + '" data-date="' + key + '" aria-label="' + escapeHtml(formatDate(key).full + ', ' + jobs.length + ' job(s)') + '"><span class="calendar-number">' + day + '</span>' + (jobs.length ? '<span class="calendar-count">' + jobs.length + '</span>' : '') + '<span class="calendar-jobs">' + chips + '</span></button>');
    }
    const selectedJobs = jobsByDay[state.selectedDay] || [];
    const label = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('#schedule-calendar').html(
      '<div class="card shadow-sm"><div class="card-body">' +
      '<div class="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-3"><h3 class="h5 mb-0">' + escapeHtml(label) + '</h3><div class="btn-group" role="group" aria-label="Change month"><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="-1" aria-label="Previous month">‹</button><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="0">Today</button><button type="button" class="btn btn-sm btn-outline-secondary calendar-nav" data-step="1" aria-label="Next month">›</button></div></div>' +
      '<div class="calendar-grid">' + weekdays.join('') + cells.join('') + '</div></div></div>' +
      '<h3 class="h5 mt-4 mb-3">' + escapeHtml(formatDate(state.selectedDay).full) + '</h3>' +
      '<div class="row g-3">' + (selectedJobs.length ? selectedJobs.map(jobCard).join('') : '<div class="col-12">' + empty('No jobs on this day.') + '</div>') + '</div>'
    );
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
      return '<article class="card shadow-sm"><div class="card-body"><div class="d-flex justify-content-between gap-2"><h3 class="h5">' + escapeHtml(location.name) + '</h3>' + actionButtons('locations', location.id) + '</div><p>' + escapeHtml(fullAddress(location)) + '</p>' + mapLink + '</div></article>';
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
      return '<span class="map-point" style="left:' + x + 'px;top:' + y + 'px" title="' + escapeHtml(item.location.name + ': ' + jobs + ' scheduled job(s)') + '">' + jobs + '</span><span class="map-label" style="left:' + x + 'px;top:' + y + 'px">' + escapeHtml(item.location.name) + '</span>';
    });
    $map.html(tiles.join('') + pins.join('') + '<div class="map-attribution">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>');
    // Offline devices keep the grid background when tiles cannot load.
    $map.find('img.map-tile').on('error', function () { $(this).remove(); });
  }

  // ---------- Shared ----------

  function renderAll() {
    $('.admin-only').toggle(isAdmin());
    $('#signed-in-user').text(state.session ? state.session.username + (isAdmin() ? ' · Administrator' : ' · Staff') : '');
    renderRoster(); renderSchedule(); renderMessages(); renderLocations();
  }

  function field(name, label, type, value, extra) {
    return '<div class="mb-3"><label class="form-label" for="field-' + name + '">' + label + '</label><input class="form-control" id="field-' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + escapeHtml(value == null ? '' : value) + '" ' + (extra || '') + '></div>';
  }

  function contactFields(record) {
    return '<div class="row"><div class="col-md-6">' + field('phone', 'Phone (optional)', 'tel', record.phone, 'maxlength="30"') + '</div><div class="col-md-6">' + field('email', 'Email (optional)', 'email', record.email, 'maxlength="100"') + '</div></div>' +
      field('birthday', 'Birthday (optional)', 'text', record.birthday, 'maxlength="10" placeholder="MM-DD or YYYY-MM-DD"') +
      '<div class="row"><div class="col-md-6">' + field('emergencyContactName', 'Emergency contact name (optional)', 'text', record.emergencyContactName, 'maxlength="80"') + '</div><div class="col-md-6">' + field('emergencyContactPhone', 'Emergency contact phone (optional)', 'tel', record.emergencyContactPhone, 'maxlength="30"') + '</div></div>';
  }

  function roleSelect(current) {
    const options = roles().map((role) => '<option value="' + escapeHtml(role) + '" ' + (normalizeRole(current) === role ? 'selected' : '') + '>' + escapeHtml(role) + '</option>').join('');
    const note = current && !roles().includes(current) ? '<div class="form-text text-warning-emphasis">The previous role "' + escapeHtml(current) + '" is not in the defined role list. Choose a replacement.</div>' : '';
    return '<div class="mb-3"><label class="form-label" for="field-role">Business role</label><select class="form-select" id="field-role" name="role"><option value="">No role</option>' + options + '</select>' + note + '</div>';
  }

  function openEditor(kind, id, parentId) {
    editing = { kind: kind, id: id || '', parentId: parentId || '' };
    const record = id ? $.extend(true, {}, byId(kind === 'reply' ? 'messages' : kind, id)) : {};
    let title = ''; let fields = '';
    if (kind === 'roster') {
      title = id ? 'Edit employee' : 'Add employee';
      const account = accountFor(record) || {};
      fields = field('name', 'Display name', 'text', record.name, 'required maxlength="60"') + roleSelect(record.role) +
        '<hr><h3 class="h6">Contact details</h3>' + contactFields(record) +
        '<div class="mb-3"><label class="form-label" for="field-notes">Roster notes (optional)</label><textarea class="form-control" id="field-notes" name="notes" maxlength="300">' + escapeHtml(record.notes || '') + '</textarea></div>' +
        '<hr><h3 class="h6">CrewBoard login</h3><p class="form-text">Both fields may be left blank. Passwords are stored only in the protected configuration file.</p>' +
        field('username', 'Username (optional)', 'text', account.username || record.username, 'maxlength="40" autocomplete="off"') +
        field('password', account.username ? 'New password (leave blank to keep current)' : 'Password (required when adding a username)', 'password', '', 'maxlength="100" autocomplete="new-password"') +
        '<div class="form-check"><input class="form-check-input" id="field-active" name="active" type="checkbox" ' + (record.active !== false ? 'checked' : '') + '><label class="form-check-label" for="field-active">Active employee</label></div>';
    } else if (kind === 'profile') {
      const employee = byId('roster', state.session.employeeId) || {};
      title = 'Edit my details';
      fields = '<p class="form-text">Only your own contact details can be changed here. Ask the owner to change your name, role, or login.</p>' + contactFields(employee);
    } else if (kind === 'locations') {
      title = id ? 'Edit location' : 'Add location';
      fields = field('name', 'Location name', 'text', record.name, 'required maxlength="80"') + field('address', 'Street address', 'text', record.address, 'required maxlength="120"') + '<div class="row"><div class="col-md-6">' + field('city', 'City', 'text', record.city, 'required maxlength="60"') + '</div><div class="col-md-3">' + field('region', 'State/region', 'text', record.region, 'maxlength="30"') + '</div><div class="col-md-3">' + field('postalCode', 'Postal code', 'text', record.postalCode, 'maxlength="16"') + '</div></div><div class="row"><div class="col-md-6">' + field('latitude', 'Latitude', 'number', record.latitude, 'required step="any" min="-90" max="90"') + '</div><div class="col-md-6">' + field('longitude', 'Longitude', 'number', record.longitude, 'required step="any" min="-180" max="180"') + '</div></div><p class="form-text">Coordinates are required so the job site can be pinned on the map. Business job sites only.</p>';
    } else if (kind === 'schedule') {
      title = id ? 'Edit job' : 'Add job';
      const locations = state.locations.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (record.locationId === item.id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
      const crew = state.roster.filter((item) => item.active || (record.crewIds || []).includes(item.id)).map((item) => '<option value="' + escapeHtml(item.id) + '" ' + ((record.crewIds || []).includes(item.id) ? 'selected' : '') + '>' + escapeHtml(item.name) + (item.role ? ' — ' + escapeHtml(item.role) : '') + '</option>').join('');
      fields = field('title', 'Job title', 'text', record.title, 'required maxlength="80"') + '<div class="row"><div class="col-md-4">' + field('date', 'Date', 'date', record.date || (state.scheduleView === 'calendar' ? state.selectedDay : ''), 'required') + '</div><div class="col-md-4">' + field('startTime', 'Start time', 'time', record.startTime, 'required') + '</div><div class="col-md-4">' + field('endTime', 'End time', 'time', record.endTime, '') + '</div></div><div class="mb-3"><label class="form-label" for="field-locationId">Business location</label><select class="form-select" id="field-locationId" name="locationId" required><option value="">Choose a location</option>' + locations + '</select></div><div class="mb-3"><label class="form-label" for="field-crewIds">Assigned crew</label><select class="form-select" id="field-crewIds" name="crewIds" multiple size="5">' + crew + '</select><div class="form-text">Use Ctrl or Command to choose more than one person.</div></div><div class="mb-3"><label class="form-label" for="field-notes">Practical job notes</label><textarea class="form-control" id="field-notes" name="notes" maxlength="500">' + escapeHtml(record.notes || '') + '</textarea></div>';
    } else if (kind === 'reply') {
      const parent = byId('messages', parentId) || {};
      title = 'Reply to ' + (parent.author || 'message');
      fields = '<blockquote class="message-quote">' + escapeHtml(String(parent.body || '').slice(0, 200)) + '</blockquote><p class="form-text">Posting as <strong>' + escapeHtml(state.session.username) + '</strong>.</p><div class="mb-3"><label class="form-label" for="field-body">Reply</label><textarea class="form-control" id="field-body" name="body" required maxlength="1000"></textarea></div>';
    } else {
      const isReply = !!record.parentId;
      title = id ? 'Edit message' : 'New message';
      fields = (id ? '<p class="form-text">Posted by <strong>' + escapeHtml(record.author || 'Unknown user') + '</strong>.</p>' : '<p class="form-text">Posting as <strong>' + escapeHtml(state.session.username) + '</strong>.</p>') +
        (isReply ? '' : field('title', 'Title', 'text', record.title, 'required maxlength="80"')) +
        '<div class="mb-3"><label class="form-label" for="field-body">Message</label><textarea class="form-control" id="field-body" name="body" required maxlength="1000">' + escapeHtml(record.body || '') + '</textarea></div>' +
        (isAdmin() && !isReply ? field('expiresAt', 'Expiry date (optional)', 'date', record.expiresAt, '') : '');
    }
    $('#record-modal-title').text(title); $('#record-fields').html(fields); modal.show();
  }

  function contactValues() {
    return { phone: $('#field-phone').val().trim(), email: $('#field-email').val().trim(), birthday: $('#field-birthday').val().trim(), emergencyContactName: $('#field-emergencyContactName').val().trim(), emergencyContactPhone: $('#field-emergencyContactPhone').val().trim() };
  }

  function formRecord() {
    const kind = editing.kind;
    const id = editing.id || makeId(kind === 'schedule' ? 'job' : kind === 'locations' ? 'loc' : 'emp');
    if (kind === 'roster') return $.extend({ id: id, name: $('#field-name').val().trim(), role: $('#field-role').val(), username: $('#field-username').val().trim(), notes: $('#field-notes').val().trim(), active: $('#field-active').prop('checked'), _password: $('#field-password').val() }, contactValues());
    if (kind === 'locations') return { id: id, name: $('#field-name').val().trim(), address: $('#field-address').val().trim(), city: $('#field-city').val().trim(), region: $('#field-region').val().trim(), postalCode: $('#field-postalCode').val().trim(), latitude: Number($('#field-latitude').val()), longitude: Number($('#field-longitude').val()) };
    return { id: id, title: $('#field-title').val().trim(), date: $('#field-date').val(), startTime: $('#field-startTime').val(), endTime: $('#field-endTime').val(), locationId: $('#field-locationId').val(), crewIds: $('#field-crewIds').val() || [], notes: $('#field-notes').val().trim() };
  }

  function saveCollection(kind, collection) {
    if (kind === 'roster') collection = collection.map((employee) => $.extend({}, employee, { role: normalizeRole(employee.role) }));
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
    if (!window.confirm('Delete this record?')) return;
    const record = byId(kind, id);
    saveCollection(kind, state[kind].filter((item) => item.id !== id)).done(() => {
      if (kind === 'roster') saveRosterAccount({ id: id, username: '' }, (record && record.username) || '', '');
    });
  }

  function submitMessage() {
    const body = $('#field-body').val().trim();
    if (editing.kind === 'reply' || !editing.id) {
      const data = { parentId: editing.parentId, title: editing.kind === 'reply' ? '' : $('#field-title').val().trim(), body: body, postedAt: localTimestamp(), expiresAt: $('#field-expiresAt').val() || '' };
      return api('messages', { method: 'POST', data: data }).done(() => { modal.hide(); reloadMessages(); }).fail((xhr) => apiError(xhr, 'Could not post the message.'));
    }
    // Owner edits re-read the board first so replies posted meanwhile are kept.
    return api('messages').done((latest) => {
      const record = latest.find((item) => item.id === editing.id);
      if (!record) { showAlert('That message was deleted.'); modal.hide(); reloadMessages(); return; }
      record.body = body;
      if (!record.parentId) { record.title = $('#field-title').val().trim(); record.expiresAt = $('#field-expiresAt').val() || ''; }
      api('messages', { method: 'PUT', data: latest }).done(() => { state.messages = latest; renderMessages(); modal.hide(); }).fail((xhr) => apiError(xhr, 'Could not save the message.'));
    }).fail((xhr) => apiError(xhr, 'Could not load messages.'));
  }

  function submitProfile() {
    return api('profile', { method: 'PUT', data: contactValues() }).done(() => {
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
      $.when(api('roster'), api('locations'), api('schedule'), api('messages'), accountsRequest).done((roster, locations, schedule, messages, accounts) => {
        const unwrap = (result) => result && result.length === 3 && typeof result[1] === 'string' ? result[0] : result;
        state.roster = unwrap(roster); state.locations = unwrap(locations); state.schedule = unwrap(schedule); state.messages = unwrap(messages); state.accounts = unwrap(accounts) || [];
        $('#connection-state').removeClass().addClass('badge text-bg-success').text('Local'); renderAll();
      }).fail(failed);
    }).fail(failed);
  }

  $(document).on('click', '.add-record', function () { openEditor($(this).data('kind'), ''); });
  $(document).on('click', '.edit-record', function () { openEditor($(this).data('kind'), $(this).data('id')); });
  $(document).on('click', '.delete-record', function () { deleteRecord($(this).data('kind'), $(this).data('id')); });
  $(document).on('click', '.edit-profile', function () { openEditor('profile', ''); });
  $(document).on('click', '.reply-message', function () { openEditor('reply', '', $(this).data('id')); });
  $(document).on('click', '.edit-message', function () { openEditor('messages', $(this).data('id')); });
  $(document).on('click', '.delete-message', function () { deleteMessage($(this).data('id')); });
  $(document).on('click', '.schedule-view', function () { state.scheduleView = $(this).data('view'); renderSchedule(); });
  $(document).on('click', '.calendar-day[data-date]', function () { state.selectedDay = $(this).data('date'); renderCalendar(); });
  $(document).on('click', '.calendar-nav', function () {
    const step = Number($(this).data('step'));
    const today = new Date();
    if (step === 0) { state.calendarMonth = new Date(today.getFullYear(), today.getMonth(), 1); state.selectedDay = dateKey(today); } else { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + step, 1); }
    renderCalendar();
  });
  $('#section-tabs').on('shown.bs.tab', 'button[data-bs-target="#locations-pane"]', renderLocationMap);
  let resizeTimer = 0;
  $(window).on('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderLocationMap, 200); });

  $('#record-form').on('submit', function (event) {
    event.preventDefault();
    if (editing.kind === 'messages' || editing.kind === 'reply') { submitMessage(); return; }
    if (editing.kind === 'profile') { submitProfile(); return; }
    const record = formRecord(); const collection = state[editing.kind].slice();
    const password = record._password || '';
    delete record._password;
    const previousRecord = editing.id ? byId(editing.kind, editing.id) : null;
    const index = collection.findIndex((item) => item.id === record.id);
    if (index >= 0) collection[index] = record; else collection.push(record);
    saveCollection(editing.kind, collection).done(() => {
      if (editing.kind === 'roster') {
        saveRosterAccount(record, (previousRecord && previousRecord.username) || '', password).done(() => modal.hide());
      } else {
        modal.hide();
      }
    });
  });
  $('#refresh-all').on('click', loadAll);
  loadAll();
})(jQuery);
