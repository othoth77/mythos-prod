// =====================================================
// MYTHOS OS — Shared Plugin Example
// examples/shared-plugin-example.js
//
// Demonstrates a shared plugin that:
//   - Contributes to the sidebar menu
//   - Provides a calendar data source
//   - Registers a dashboard widget
//   - Owns a storage key
//   - Contributes to global search
//
// This file is for reference only — NOT loaded by the app.
// =====================================================

Plugin.create({
  id:      'agenda',
  label:   'Agenda',
  version: '1.0.0',
  type:    'shared',

  onBoot: function () {
    // Called once during Platform.boot() — load minimal data
    // At this point localStorage is available; network is not yet ready
  },

  onReady: function () {
    // Called after all plugins have booted — safe to make API calls
    // e.g. trigger initial data sync
  }
})
.defineMenu({
  section: 'Général',
  order:   3,
  icon:    '📅'
})
.defineRoutes([
  { id: 'agenda',        label: 'Agenda',          icon: '📅' },
  { id: 'agenda-detail', label: 'Détail événement', icon: '📋' }
])
.defineStorage([
  'mp_agenda_events',
  'mp_agenda_categories'
])
.defineCalendar({
  // provider receives { start: Date, end: Date }
  // and must return an array of event objects
  provider: function (range) {
    var raw = JSON.parse(localStorage.getItem('mp_agenda_events') || '[]');
    return raw.filter(function (ev) {
      var d = new Date(ev.date);
      return d >= range.start && d <= range.end;
    });
  }
})
.defineWidgets([
  {
    id:    'agenda:upcoming',
    label: 'Prochains événements',
    zone:  'dashboard',
    order: 20,
    render: function () {
      // Called by the dashboard to refresh this widget's DOM
    }
  }
])
.defineSearch({
  handler: function (query) {
    var q = query.toLowerCase();
    var raw = JSON.parse(localStorage.getItem('mp_agenda_events') || '[]');
    return raw
      .filter(function (ev) { return ev.title && ev.title.toLowerCase().indexOf(q) !== -1; })
      .map(function (ev) {
        return { label: ev.title, route: 'agenda-detail', data: ev };
      });
  }
})
.build();
