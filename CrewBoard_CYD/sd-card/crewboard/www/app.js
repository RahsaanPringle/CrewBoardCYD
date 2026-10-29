/* global bootstrap */
(function ($) {
  'use strict';

  const state = { session: null, roster: [], locations: [], schedule: [], messages: [], accounts: [] };
  const modal = new bootstrap.Modal(document.getElementById('record-modal'));
  let editing = { kind: '', id: '' };

  function escapeHtml(value) { return $('<div>').text(value == null ? '' : String(value)).html(); }
  function makeId(prefix) { return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function byId(kind, id) { return state[kind].find((item) => item.id === id); }
  function locationName(id) { const item = byId('locations', id); return item ? item.name : 'Unknown location'; }
  function employeeName(id) { const item = byId('roster', id); return item ? item.name : 'Unknown employee'; }
  function accountFor(employee) { return state.accounts.find((account) => account.employeeId === employee.id || (!account.employeeId && account.username === employee.username)); }
  function empty(message) { return '<div class="empty-state">' + escapeHtml(message) + '</div>'; }

  function showAlert(message, type) {
    $('#alert-area').html('<div class="alert alert-' + (type || 'danger') + ' alert-dismissible fade show" role="alert">' + escapeHtml(message) + '<button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>');
  }

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
    const date = new Date(value + 'T12:00:00');
    if (Number.isNaN(date.getTime())) return { month: '', day: '', full: value };
    return {
      month: date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase(),
      day: date.toLocaleDateString(undefined, { day: '2-digit' }),
      full: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    };
  }

  function actionButtons(kind, id) {
    if (!state.session || !state.session.isAdmin) return '';
    return '<span class="record-actions"><button class="btn btn-sm btn-outline-primary edit-record" data-kind="' + kind + '" data-id="' + escapeHtml(id) + '">Edit</button> <button class="btn btn-sm btn-outline-danger delete-record" data-kind="' + kind + '" data-id="' + escapeHtml(id) + '">Delete</button></span>';
  }

  function renderRoster() {
    const rows = state.roster.map((employee) => {
      const contact = [employee.phone, employee.email].filter(Boolean).map(escapeHtml).join('<br>') || '<span class="text-secondary">—</span>';
      const account = accountFor(employee);
      const loginUsername = account ? account.username : employee.username;
      return '<tr><td class="fw-semibold">' + escapeHtml(employee.name) + '</td><td>' + escapeHtml(employee.role || '—') + '</td><td>' + contact + '</td><td>' + escapeHtml(employee.birthday || '—') + '</td><td>' + (loginUsername ? '<span class="badge text-bg-info">' + escapeHtml(loginUsername) + '</span>' : '<span class="text-secondary">None</span>') + '</td><td><span class="badge ' + (employee.active ? 'text-bg-success' : 'text-bg-secondary') + '">' + (employee.active ? 'Active' : 'Inactive') + '</span></td><td class="admin-only text-end">' + actionButtons('roster', employee.id) + '</td></tr>';
    });
    $('#roster-list').html(rows.length ? rows.join('') : '<tr><td colspan="7">' + empty('No employees have been added.') + '</td></tr>');
  }

  function renderSchedule() {
    const jobs = state.schedule.slice().sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    const cards = jobs.map((job) => {
      const date = formatDate(job.date);
      const crew = (job.crewIds || []).map(employeeName).join(', ') || 'Unassigned';
      return '<div class="col-12"><article class="card shadow-sm"><div class="card-body d-flex flex-column flex-sm-row gap-3"><div class="job-date"><small>' + escapeHtml(date.month) + '</small><strong>' + escapeHtml(date.day) + '</strong></div><div class="flex-grow-1"><div class="d-flex flex-wrap justify-content-between gap-2"><div><h3 class="h5 mb-1">' + escapeHtml(job.title) + '</h3><p class="text-secondary mb-2">' + escapeHtml(date.full) + ' · ' + escapeHtml(job.startTime || '') + (job.endTime ? '–' + escapeHtml(job.endTime) : '') + '</p></div>' + actionButtons('schedule', job.id) + '</div><p class="mb-1"><strong>Location:</strong> ' + escapeHtml(locationName(job.locationId)) + '</p><p class="mb-1"><strong>Crew:</strong> ' + escapeHtml(crew) + '</p>' + (job.notes ? '<p class="mb-0 mt-2">' + escapeHtml(job.notes) + '</p>' : '') + '</div></div></article></div>';
    });
    $('#schedule-list').html(cards.length ? cards.join('') : '<div class="col-12">' + empty('No jobs have been scheduled.') + '</div>');
  }

  function renderMessages() {
    const cards = state.messages.slice().sort((a, b) => b.postedAt.localeCompare(a.postedAt)).map((message) => '<div class="col-md-6"><article class="card h-100 shadow-sm"><div class="card-body"><div class="d-flex justify-content-between gap-2"><h3 class="h5">' + escapeHtml(message.title) + '</h3>' + actionButtons('messages', message.id) + '</div><p class="small text-secondary">Posted ' + escapeHtml(formatDate(message.postedAt).full) + (message.expiresAt ? ' · Expires ' + escapeHtml(formatDate(message.expiresAt).full) : '') + '</p><p class="mb-0 message-body">' + escapeHtml(message.body).replace(/\n/g, '<br>') + '</p></div></article></div>');
    $('#messages-list').html(cards.length ? cards.join('') : '<div class="col-12">' + empty('There are no announcements.') + '</div>');
  }

  function fullAddress(location) {
    return [location.address, location.city, location.region, location.postalCode].filter(Boolean).join(', ');
  }

  function renderLocations() {
    const cards = state.locations.map((location) => {
      const hasCoordinates = Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude));
      const mapLink = hasCoordinates ? '<a class="btn btn-sm btn-outline-secondary" target="_blank" rel="noopener" href="https://www.openstreetmap.org/?mlat=' + encodeURIComponent(location.latitude) + '&mlon=' + encodeURIComponent(location.longitude) + '#map=16/' + encodeURIComponent(location.latitude) + '/' + encodeURIComponent(location.longitude) + '">Open street map</a>' : '';
      return '<article class="card shadow-sm"><div class="card-body"><div class="d-flex justify-content-between gap-2"><h3 class="h5">' + escapeHtml(location.name) + '</h3>' + actionButtons('locations', location.id) + '</div><p>' + escapeHtml(fullAddress(location)) + '</p>' + mapLink + '</div></article>';
    });
    $('#locations-list').html(cards.length ? cards.join('') : empty('No business locations have been added.'));
    renderLocationPlot();
  }

  function renderLocationPlot() {
    const plotted = state.locations.filter((location) => Number.isFinite(Number(location.latitude)) && Number.isFinite(Number(location.longitude)));
    if (!plotted.length) { $('#location-map').html(empty('Add coordinates to show locations here.')); return; }
    const lats = plotted.map((item) => Number(item.latitude));
    const lons = plotted.map((item) => Number(item.longitude));
    const minLat = Math.min.apply(null, lats); const maxLat = Math.max.apply(null, lats);
    const minLon = Math.min.apply(null, lons); const maxLon = Math.max.apply(null, lons);
    const latRange = Math.max(maxLat - minLat, 0.01); const lonRange = Math.max(maxLon - minLon, 0.01);
    const html = plotted.map((location) => {
      const left = 8 + ((Number(location.longitude) - minLon) / lonRange) * 84;
      const top = 92 - ((Number(location.latitude) - minLat) / latRange) * 84;
      const jobs = state.schedule.filter((job) => job.locationId === location.id).length;
      return '<span class="map-point" style="left:' + left.toFixed(2) + '%;top:' + top.toFixed(2) + '%" title="' + escapeHtml(location.name + ': ' + jobs + ' scheduled job(s)') + '">' + jobs + '</span><span class="map-label" style="left:' + left.toFixed(2) + '%;top:' + top.toFixed(2) + '%">' + escapeHtml(location.name) + '</span>';
    });
    $('#location-map').html(html.join(''));
  }

  function renderAll() {
    $('.admin-only').toggle(!!(state.session && state.session.isAdmin));
    $('#signed-in-user').text(state.session ? state.session.username + (state.session.isAdmin ? ' · Administrator' : ' · Staff') : '');
    renderRoster(); renderSchedule(); renderMessages(); renderLocations();
  }

  function field(name, label, type, value, extra) {
    return '<div class="mb-3"><label class="form-label" for="field-' + name + '">' + label + '</label><input class="form-control" id="field-' + name + '" name="' + name + '" type="' + (type || 'text') + '" value="' + escapeHtml(value || '') + '" ' + (extra || '') + '></div>';
  }

  function openEditor(kind, id) {
    editing = { kind: kind, id: id || '' };
    const record = id ? $.extend(true, {}, byId(kind, id)) : {};
    let title = ''; let fields = '';
    if (kind === 'roster') {
      title = id ? 'Edit employee' : 'Add employee';
      const account = accountFor(record) || {};
      fields = field('name', 'Display name', 'text', record.name, 'required maxlength="60"') +
        field('role', 'Business role (optional)', 'text', record.role, 'maxlength="40"') +
        '<hr><h3 class="h6">Contact details</h3><div class="row"><div class="col-md-6">' + field('phone', 'Phone (optional)', 'tel', record.phone, 'maxlength="30"') + '</div><div class="col-md-6">' + field('email', 'Email (optional)', 'email', record.email, 'maxlength="100"') + '</div></div>' +
        field('birthday', 'Birthday (optional)', 'text', record.birthday, 'maxlength="10" placeholder="MM-DD or YYYY-MM-DD"') +
        '<div class="row"><div class="col-md-6">' + field('emergencyContactName', 'Emergency contact name (optional)', 'text', record.emergencyContactName, 'maxlength="80"') + '</div><div class="col-md-6">' + field('emergencyContactPhone', 'Emergency contact phone (optional)', 'tel', record.emergencyContactPhone, 'maxlength="30"') + '</div></div>' +
        '<div class="mb-3"><label class="form-label" for="field-notes">Roster notes (optional)</label><textarea class="form-control" id="field-notes" name="notes" maxlength="300">' + escapeHtml(record.notes || '') + '</textarea></div>' +
        '<hr><h3 class="h6">CrewBoard login</h3><p class="form-text">Both fields may be left blank. Passwords are stored only in the protected configuration file.</p>' +
        field('username', 'Username (optional)', 'text', account.username || record.username, 'maxlength="40" autocomplete="off"') +
        field('password', account.username ? 'New password (leave blank to keep current)' : 'Password (required when adding a username)', 'password', '', 'maxlength="100" autocomplete="new-password"') +
        '<div class="form-check"><input class="form-check-input" id="field-active" name="active" type="checkbox" ' + (record.active !== false ? 'checked' : '') + '><label class="form-check-label" for="field-active">Active employee</label></div>';
    } else if (kind === 'locations') {
      title = id ? 'Edit location' : 'Add location';
      fields = field('name', 'Location name', 'text', record.name, 'required maxlength="80"') + field('address', 'Street address', 'text', record.address, 'required maxlength="120"') + '<div class="row"><div class="col-md-6">' + field('city', 'City', 'text', record.city, 'required maxlength="60"') + '</div><div class="col-md-3">' + field('region', 'State/region', 'text', record.region, 'maxlength="30"') + '</div><div class="col-md-3">' + field('postalCode', 'Postal code', 'text', record.postalCode, 'maxlength="16"') + '</div></div><div class="row"><div class="col-md-6">' + field('latitude', 'Latitude', 'number', record.latitude, 'step="any" min="-90" max="90"') + '</div><div class="col-md-6">' + field('longitude', 'Longitude', 'number', record.longitude, 'step="any" min="-180" max="180"') + '</div></div><p class="form-text">Coordinates are for business job sites only.</p>';
    } else if (kind === 'schedule') {
      title = id ? 'Edit job' : 'Add job';
      const locations = state.locations.map((item) => '<option value="' + escapeHtml(item.id) + '" ' + (record.locationId === item.id ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('');
      const crew = state.roster.filter((item) => item.active || (record.crewIds || []).includes(item.id)).map((item) => '<option value="' + escapeHtml(item.id) + '" ' + ((record.crewIds || []).includes(item.id) ? 'selected' : '') + '>' + escapeHtml(item.name) + ' — ' + escapeHtml(item.role) + '</option>').join('');
      fields = field('title', 'Job title', 'text', record.title, 'required maxlength="80"') + '<div class="row"><div class="col-md-4">' + field('date', 'Date', 'date', record.date, 'required') + '</div><div class="col-md-4">' + field('startTime', 'Start time', 'time', record.startTime, 'required') + '</div><div class="col-md-4">' + field('endTime', 'End time', 'time', record.endTime, '') + '</div></div><div class="mb-3"><label class="form-label" for="field-locationId">Business location</label><select class="form-select" id="field-locationId" name="locationId" required><option value="">Choose a location</option>' + locations + '</select></div><div class="mb-3"><label class="form-label" for="field-crewIds">Assigned crew</label><select class="form-select" id="field-crewIds" name="crewIds" multiple size="5">' + crew + '</select><div class="form-text">Use Ctrl or Command to choose more than one person.</div></div><div class="mb-3"><label class="form-label" for="field-notes">Practical job notes</label><textarea class="form-control" id="field-notes" name="notes" maxlength="500">' + escapeHtml(record.notes || '') + '</textarea></div>';
    } else {
      title = id ? 'Edit message' : 'Add message';
      fields = field('title', 'Title', 'text', record.title, 'required maxlength="80"') + '<div class="mb-3"><label class="form-label" for="field-body">Message</label><textarea class="form-control" id="field-body" name="body" required maxlength="1000">' + escapeHtml(record.body || '') + '</textarea></div><div class="row"><div class="col-md-6">' + field('postedAt', 'Posted date', 'date', record.postedAt || new Date().toISOString().slice(0, 10), 'required') + '</div><div class="col-md-6">' + field('expiresAt', 'Expiry date (optional)', 'date', record.expiresAt, '') + '</div></div>';
    }
    $('#record-modal-title').text(title); $('#record-fields').html(fields); modal.show();
  }

  function formRecord() {
    const kind = editing.kind; const old = editing.id ? byId(kind, editing.id) : null;
    const id = editing.id || makeId(kind === 'schedule' ? 'job' : kind === 'locations' ? 'loc' : kind === 'roster' ? 'emp' : 'msg');
    if (kind === 'roster') return { id: id, name: $('#field-name').val().trim(), role: $('#field-role').val().trim(), username: $('#field-username').val().trim(), phone: $('#field-phone').val().trim(), email: $('#field-email').val().trim(), birthday: $('#field-birthday').val().trim(), emergencyContactName: $('#field-emergencyContactName').val().trim(), emergencyContactPhone: $('#field-emergencyContactPhone').val().trim(), notes: $('#field-notes').val().trim(), active: $('#field-active').prop('checked'), _password: $('#field-password').val() };
    if (kind === 'locations') return { id: id, name: $('#field-name').val().trim(), address: $('#field-address').val().trim(), city: $('#field-city').val().trim(), region: $('#field-region').val().trim(), postalCode: $('#field-postalCode').val().trim(), latitude: $('#field-latitude').val() === '' ? null : Number($('#field-latitude').val()), longitude: $('#field-longitude').val() === '' ? null : Number($('#field-longitude').val()) };
    if (kind === 'schedule') return { id: id, title: $('#field-title').val().trim(), date: $('#field-date').val(), startTime: $('#field-startTime').val(), endTime: $('#field-endTime').val(), locationId: $('#field-locationId').val(), crewIds: $('#field-crewIds').val() || [], notes: $('#field-notes').val().trim() };
    return { id: id, title: $('#field-title').val().trim(), body: $('#field-body').val().trim(), postedAt: $('#field-postedAt').val(), expiresAt: $('#field-expiresAt').val() };
  }

  function saveCollection(kind, collection) {
    return api(kind, { method: 'PUT', data: collection }).done(() => { state[kind] = collection; renderAll(); }).fail((xhr) => showAlert((xhr.responseJSON && xhr.responseJSON.error) || 'Could not save changes.'));
  }

  function saveRosterAccount(employee, previousUsername, password) {
    if (!state.session || !state.session.isAdmin) return $.Deferred().resolve().promise();
    return api('accounts', { method: 'PUT', data: { employeeId: employee.id, username: employee.username || '', password: password || '', previousUsername: previousUsername || '' } })
      .done((accounts) => { state.accounts = accounts; renderAll(); })
      .fail((xhr) => showAlert((xhr.responseJSON && xhr.responseJSON.error) || 'The roster saved, but the login could not be updated.'));
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

  function loadAll() {
    $('#connection-state').removeClass().addClass('badge text-bg-warning').text('Loading');
    return api('session').done((session) => {
      state.session = session;
      const accountsRequest = session.isAdmin ? api('accounts') : $.Deferred().resolve([]).promise();
      $.when(api('roster'), api('locations'), api('schedule'), api('messages'), accountsRequest).done((roster, locations, schedule, messages, accounts) => {
        const unwrap = (result) => result && result.length === 3 && typeof result[1] === 'string' ? result[0] : result;
        state.roster = unwrap(roster); state.locations = unwrap(locations); state.schedule = unwrap(schedule); state.messages = unwrap(messages); state.accounts = unwrap(accounts) || [];
        $('#connection-state').removeClass().addClass('badge text-bg-success').text('Local'); renderAll();
      }).fail((xhr) => {
        $('#connection-state').removeClass().addClass('badge text-bg-danger').text('Unavailable');
        showAlert((xhr.responseJSON && xhr.responseJSON.error) || 'CrewBoard could not load data from the CYD.');
      });
    }).fail((xhr) => {
      $('#connection-state').removeClass().addClass('badge text-bg-danger').text('Unavailable');
      showAlert((xhr.responseJSON && xhr.responseJSON.error) || 'CrewBoard could not load data from the CYD.');
    });
  }

  $(document).on('click', '.add-record', function () { openEditor($(this).data('kind'), ''); });
  $(document).on('click', '.edit-record', function () { openEditor($(this).data('kind'), $(this).data('id')); });
  $(document).on('click', '.delete-record', function () { deleteRecord($(this).data('kind'), $(this).data('id')); });
  $('#record-form').on('submit', function (event) {
    event.preventDefault();
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
