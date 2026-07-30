// =====================================================
// MYTHOS OS — Business Plugin Example (full-featured)
// examples/business-plugin-example.js
//
// Demonstrates a fully-featured business plugin that:
//   - Owns multiple views and data collections
//   - Registers KPI tiles on the dashboard
//   - Exposes search integration
//   - Provides calendar contributions
//   - Declares role-based permissions
//   - Exposes configurable settings
//
// This file is for reference only — NOT loaded by the app.
// =====================================================

Plugin.create({
  id:      'inventory',
  label:   'Inventaire',
  version: '1.0.0',
  type:    'business',

  onBoot: function () {
    // Hydrate quick-access cache from localStorage
    // Only use synchronous operations here
    var raw = localStorage.getItem('mp_inventory_items');
    if (!raw) { localStorage.setItem('mp_inventory_items', JSON.stringify([])); }
  },

  onReady: function () {
    // All plugins booted — safe to emit events, make API calls
    // E.g. trigger a sync for fresh data
    if (typeof Events !== 'undefined') {
      Events.emit('inventory:ready', {});
    }
  }
})
.defineMenu({
  section: 'Inventaire',
  order:   20,
  icon:    '📦'
})
.defineRoutes([
  { id: 'inventory-dashboard', label: 'Vue d\'ensemble', icon: '📊' },
  { id: 'inventory-list',      label: 'Articles',        icon: '📋' },
  { id: 'inventory-add',       label: 'Ajouter',         icon: '➕' },
  { id: 'inventory-movements', label: 'Mouvements',      icon: '🔄' },
  { id: 'inventory-reports',   label: 'Rapports',        icon: '📈' },
  { id: 'inventory-settings',  label: 'Paramètres',      icon: '⚙️'  }
])
.defineStorage([
  'mp_inventory_items',
  'mp_inventory_movements',
  'mp_inventory_categories',
  'mp_inventory_suppliers'
])
.defineWidgets([
  {
    id:    'inventory:stock-kpi',
    label: 'Stock actuel',
    zone:  'dashboard',
    order: 30,
    render: function () {
      // Update the widget's tile in the dashboard DOM
      var items = JSON.parse(localStorage.getItem('mp_inventory_items') || '[]');
      var total = items.reduce(function (sum, i) { return sum + (i.qty || 0); }, 0);
      var el = document.getElementById('kpi-inventory-stock');
      if (el) { el.textContent = total; }
    }
  },
  {
    id:    'inventory:low-stock-alert',
    label: 'Alertes stock bas',
    zone:  'dashboard',
    order: 31,
    render: function () {
      var items = JSON.parse(localStorage.getItem('mp_inventory_items') || '[]');
      var low   = items.filter(function (i) { return i.qty <= (i.minQty || 0); });
      var el    = document.getElementById('kpi-inventory-low');
      if (el) { el.textContent = low.length; }
    }
  }
])
.definePermissions({
  roles:       ['admin', 'manager', 'inventory-clerk'],
  requireAuth: true
})
.defineSettings([
  {
    key:     'low_stock_threshold',
    label:   'Seuil de stock bas',
    type:    'number',
    default: 5
  },
  {
    key:     'auto_reorder',
    label:   'Commande automatique',
    type:    'boolean',
    default: false
  },
  {
    key:     'default_currency',
    label:   'Devise par défaut',
    type:    'select',
    options: ['TND', 'EUR', 'USD'],
    default: 'TND'
  }
])
.defineSearch({
  handler: function (query) {
    var q = query.toLowerCase();
    var items = JSON.parse(localStorage.getItem('mp_inventory_items') || '[]');
    return items
      .filter(function (i) {
        return (i.name  && i.name.toLowerCase().indexOf(q)  !== -1) ||
               (i.ref   && i.ref.toLowerCase().indexOf(q)   !== -1) ||
               (i.barcode && i.barcode.indexOf(query)       !== -1);
      })
      .map(function (i) {
        return { label: i.name + ' (' + i.ref + ')', route: 'inventory-list', data: i };
      });
  }
})
.defineCalendar({
  // Contribute delivery / expiry dates to the global calendar
  provider: function (range) {
    var movements = JSON.parse(localStorage.getItem('mp_inventory_movements') || '[]');
    return movements
      .filter(function (m) {
        var d = new Date(m.expectedDate);
        return m.expectedDate && d >= range.start && d <= range.end;
      })
      .map(function (m) {
        return {
          id:    'inv-mv-' + m.id,
          title: 'Livraison: ' + m.ref,
          date:  m.expectedDate,
          type:  'inventory'
        };
      });
  }
})
.defineDashboard({
  tiles: [
    { id: 'kpi-inventory-stock', label: 'Articles en stock' },
    { id: 'kpi-inventory-low',   label: 'Stock bas'         }
  ]
})
.build();
