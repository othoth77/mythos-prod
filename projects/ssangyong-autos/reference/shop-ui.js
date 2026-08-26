'use strict';
// =====================================================
// MYTHOS — SsangYong Parts storefront — SYA-SHOP-2
// projects/ssangyong-autos/reference/shop-ui.js
//
// The SYA-SHOP-1 storefront redesigned as a real parts-commerce UI: a home
// view with three discovery modes (vehicle, OEM reference, browse), a
// catalogue PLP with vehicle / availability / brand filters and sorting, a
// product page with a data-backed "compatible with your vehicle" badge, a
// models view and an assistance view. Same conventions as SYA-SHOP-1 —
// no framework, no build step, and it runs under the CSP api.js sends
// (`script-src 'self'`), so there is no inline handler anywhere.
//
// TEXT IS NEVER INTERPOLATED INTO HTML. Every catalog string — titles,
// criteria, spec labels — originates from a scraped third-party site and is
// therefore untrusted. This file builds nodes and assigns textContent; there
// is no innerHTML assignment carrying catalog data, so a crafted product
// title cannot become markup.
//
// State lives in the query string (?view / ?p / ?model / ?motor / ?brand /
// ?avail / ?sort / ?q / ?page) so every view, filter combination and product
// is linkable and back-button-correct. The vehicle context (?model/?motor)
// survives into the product page, which is what lets the fit badge say
// "compatible with your vehicle" from catalogue data rather than guesswork.
//
// WHATSAPP IS GATED, NOT INVENTED. The catalogue holds no contact number
// (schema: no PII, no owner data), so CONTACT.whatsapp ships EMPTY and every
// WhatsApp control stays hidden until the owner sets the real number here.
// No number is ever fabricated. wa.me is a navigation target only — the page
// fetches exclusively same-origin API paths.
// =====================================================

(function () {
  var PAGE_SIZE = 24;

  // Owner-provided contact channel. Empty string = channel not yet opened:
  // every element listed in WA_ELEMENT_IDS stays hidden and no number is
  // invented. Set to the international number without '+' (e.g. '216XXXXXXXX')
  // to activate every WhatsApp control at once.
  var CONTACT = { whatsapp: '' };
  var WA_BASE = 'https://wa.me/';
  var WA_ELEMENT_IDS = ['topbar-whatsapp', 'action-whatsapp', 'empty-whatsapp',
    'product-whatsapp', 'help-whatsapp', 'footer-whatsapp', 'wa-float'];

  var el = {
    viewHome: document.getElementById('view-home'),
    viewCatalogue: document.getElementById('view-catalogue'),
    viewProduct: document.getElementById('view-product'),
    viewHelp: document.getElementById('view-help'),
    viewModels: document.getElementById('view-models'),
    state: document.getElementById('state-message'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    vehicleSummary: document.getElementById('vehicle-summary'),
    // home
    heroCounts: document.getElementById('hero-counts'),
    heroModel: document.getElementById('hero-model'),
    heroMotor: document.getElementById('hero-motor'),
    heroVehicleGo: document.getElementById('hero-vehicle-go'),
    heroOemForm: document.getElementById('hero-oem-form'),
    heroOemInput: document.getElementById('hero-oem-input'),
    homeModelGrid: document.getElementById('home-model-grid'),
    homeBrandStrip: document.getElementById('home-brand-strip'),
    // catalogue
    model: document.getElementById('filter-model'),
    motorization: document.getElementById('filter-motorization'),
    vehicleHint: document.getElementById('vehicle-hint'),
    availability: document.getElementById('filter-availability'),
    brands: document.getElementById('filter-brands'),
    brandsCount: document.getElementById('brands-count'),
    reset: document.getElementById('filter-reset'),
    title: document.getElementById('results-title'),
    count: document.getElementById('results-count'),
    activeVehicle: document.getElementById('active-vehicle'),
    sort: document.getElementById('sort-select'),
    viewGridBtn: document.getElementById('view-grid-btn'),
    viewListBtn: document.getElementById('view-list-btn'),
    grid: document.getElementById('product-grid'),
    emptyState: document.getElementById('empty-state'),
    paging: document.getElementById('paging'),
    pagePrev: document.getElementById('page-prev'),
    pageNext: document.getElementById('page-next'),
    pageStatus: document.getElementById('page-status'),
    modelsGrid: document.getElementById('models-grid'),
    footerCounts: document.getElementById('footer-counts')
  };

  var facets = { models: [], brands: [], availabilities: [] };
  var motorizationCache = {};
  var listMode = false; // presentation preference only — never persisted (no storage)

  // ---------------------------------------------------------------------
  // Formatting
  // ---------------------------------------------------------------------

  // price_tnd arrives as the exact NUMERIC(8,2) decimal string the API
  // promises never to coerce. Formatting for display is the first and only
  // place it becomes a number, and it stays a string here too: split on the
  // decimal point rather than parseFloat, so the value shown is byte-for-byte
  // what the database holds.
  function money(decimalString) {
    if (typeof decimalString !== 'string' || decimalString.indexOf('.') === -1) return '—';
    var parts = decimalString.split('.');
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return whole + ',' + parts[1] + ' DT';
  }

  function years(from, to) {
    if (from === null && to === null) return '—';
    if (from !== null && to === null) return 'depuis ' + from;
    if (from === null) return "jusqu'à " + to;
    return from + ' – ' + to;
  }

  function modelLabel(m) {
    return m.generation_code ? m.model_name + ' (' + m.generation_code + ')' : m.model_name;
  }

  function plural(n, one, many) {
    return n + ' ' + (n <= 1 ? one : many);
  }

  function formatDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
  }

  // ---------------------------------------------------------------------
  // DOM helpers — node construction only, never markup strings
  // ---------------------------------------------------------------------

  function node(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function clear(parent) {
    while (parent.firstChild) parent.removeChild(parent.firstChild);
  }

  function setState(message, isError) {
    el.state.textContent = message || '';
    el.state.classList.toggle('error', !!isError);
  }

  // ---------------------------------------------------------------------
  // WhatsApp gating — hidden until CONTACT.whatsapp is set by the owner
  // ---------------------------------------------------------------------

  function waHref(message) {
    return WA_BASE + CONTACT.whatsapp + '?text=' + encodeURIComponent(message);
  }

  function applyWhatsAppGate(defaultMessage) {
    var enabled = CONTACT.whatsapp !== '';
    WA_ELEMENT_IDS.forEach(function (id) {
      var element = document.getElementById(id);
      if (!element) return;
      element.hidden = !enabled;
      if (enabled) element.href = waHref(defaultMessage);
    });
    var note = document.getElementById('help-channel-note');
    if (note) {
      note.textContent = enabled
        ? 'Réponse par le support technique pendant les horaires d’ouverture.'
        : 'Le canal de contact direct n’est pas encore activé sur cette version du catalogue.';
    }
  }

  function setWaHref(id, message) {
    if (CONTACT.whatsapp === '') return;
    var element = document.getElementById(id);
    if (element) element.href = waHref(message);
  }

  // ---------------------------------------------------------------------
  // API access — same origin, read-only
  // ---------------------------------------------------------------------

  function api(path) {
    return fetch(path, { headers: { 'Accept': 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  // ---------------------------------------------------------------------
  // URL state
  // ---------------------------------------------------------------------

  var SORT_VALUES = ['reference', 'price_asc', 'price_desc', 'recent'];

  function readState() {
    var p = new URLSearchParams(window.location.search);
    var page = parseInt(p.get('page') || '1', 10);
    var sort = p.get('sort') || 'reference';
    if (SORT_VALUES.indexOf(sort) === -1) sort = 'reference';
    return {
      view: p.get('view') || '',
      product: p.get('p') || null,
      model: p.get('model') || '',
      motorization: p.get('motor') || '',
      brand: p.get('brand') || '',
      avail: p.get('avail') || '',
      query: p.get('q') || '',
      sort: sort,
      page: Number.isFinite(page) && page > 0 ? page : 1
    };
  }

  function hasCatalogueCriteria(state) {
    return !!(state.model || state.motorization || state.brand || state.avail ||
              state.query || state.page > 1 || state.sort !== 'reference');
  }

  function currentView(state) {
    if (state.product) return 'product';
    if (state.view === 'aide') return 'help';
    if (state.view === 'models') return 'models';
    if (state.view === 'cat' || hasCatalogueCriteria(state)) return 'cat';
    return 'home';
  }

  function writeState(next, replace) {
    var p = new URLSearchParams();
    if (next.product) {
      p.set('p', next.product);
      // The vehicle context survives into the product page — it is what lets
      // the fit badge compare this part's fitment against YOUR vehicle.
      if (next.model) p.set('model', next.model);
      if (next.motorization) p.set('motor', next.motorization);
    } else {
      if (next.view) p.set('view', next.view);
      if (next.model) p.set('model', next.model);
      if (next.motorization) p.set('motor', next.motorization);
      if (next.brand) p.set('brand', next.brand);
      if (next.avail) p.set('avail', next.avail);
      if (next.query) p.set('q', next.query);
      if (next.sort && next.sort !== 'reference') p.set('sort', next.sort);
      if (next.page > 1) p.set('page', String(next.page));
    }
    var qs = p.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    render();
    if (!replace && window.scrollTo) window.scrollTo(0, 0);
  }

  function navigate(patch) {
    var next = Object.assign(readState(), patch);
    // Any filter change invalidates the current page number — staying on
    // page 4 of a result set that now has one page shows an empty grid.
    if (!('page' in patch)) next.page = 1;
    writeState(next);
  }

  // Any filter/search action implies the catalogue view.
  function navigateCatalogue(patch) {
    navigate(Object.assign({ view: 'cat', product: null }, patch));
  }

  // ---------------------------------------------------------------------
  // Facets
  // ---------------------------------------------------------------------

  function loadFacets() {
    return Promise.all([
      api('/api/vehicle-models'),
      api('/api/brands'),
      api('/api/availabilities'),
      api('/api/health')
    ]).then(function (results) {
      facets.models = results[0].vehicle_models;
      facets.brands = results[1].brands;
      facets.availabilities = results[2].availabilities;
      var c = results[3].counts;
      var countsText =
        plural(c.products, 'pièce référencée', 'pièces référencées') + ' · ' +
        plural(c.vehicle_models, 'modèle', 'modèles') + ' · ' +
        plural(c.vehicle_motorizations, 'motorisation', 'motorisations');
      el.footerCounts.textContent = countsText;
      el.heroCounts.textContent = countsText;

      facets.models.forEach(function (m) {
        [el.model, el.heroModel].forEach(function (select) {
          var opt = node('option', null, modelLabel(m) + ' (' + m.product_count + ')');
          opt.value = String(m.id);
          select.appendChild(opt);
        });
      });
    });
  }

  function findModel(state) {
    return facets.models.filter(function (x) { return String(x.id) === state.model; })[0] || null;
  }

  function findMotor(state) {
    if (!state.motorization || !motorizationCache[state.model]) return null;
    return motorizationCache[state.model].filter(function (x) {
      return String(x.id) === state.motorization;
    })[0] || null;
  }

  function vehicleText(state) {
    var m = findModel(state);
    if (!m) return '';
    var text = modelLabel(m);
    var mo = findMotor(state);
    if (mo) text += ' · ' + mo.motorisation;
    return text;
  }

  function renderVehicleSummary(state) {
    var text = vehicleText(state);
    el.vehicleSummary.textContent = text || 'Non défini';
  }

  function renderBrands(state) {
    clear(el.brands);
    // The list scrolls, so say how many there are — otherwise it reads as a
    // short list that simply ends.
    el.brandsCount.textContent = '(' + facets.brands.length + ')';
    facets.brands.forEach(function (b) {
      var li = node('li');
      var button = node('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(state.brand === b.product_brand));
      button.appendChild(node('span', null, b.product_brand));
      button.appendChild(node('span', 'n', b.product_count));
      button.addEventListener('click', function () {
        navigateCatalogue({ brand: state.brand === b.product_brand ? '' : b.product_brand });
      });
      li.appendChild(button);
      el.brands.appendChild(li);
    });
  }

  function renderAvailabilities(state) {
    clear(el.availability);
    facets.availabilities.forEach(function (a) {
      var li = node('li');
      var button = node('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(state.avail === a.availability));
      button.appendChild(node('span', null, a.availability));
      button.appendChild(node('span', 'n', a.product_count));
      button.addEventListener('click', function () {
        navigateCatalogue({ avail: state.avail === a.availability ? '' : a.availability });
      });
      li.appendChild(button);
      el.availability.appendChild(li);
    });
  }

  function loadMotorizations(modelId) {
    if (motorizationCache[modelId]) return Promise.resolve(motorizationCache[modelId]);
    return api('/api/vehicle-models/' + encodeURIComponent(modelId) + '/motorizations')
      .then(function (data) {
        motorizationCache[modelId] = data.motorizations;
        return data.motorizations;
      });
  }

  function motorOptionLabel(mo) {
    var label = mo.motorisation + ' · ' + years(mo.year_from, mo.year_to);
    if (mo.fuel) label += ' · ' + mo.fuel;
    return label + ' (' + mo.product_count + ')';
  }

  function renderMotorizations(state) {
    clear(el.motorization);
    var all = node('option', null, 'Toutes les motorisations');
    all.value = '';
    el.motorization.appendChild(all);

    if (!state.model) {
      el.motorization.disabled = true;
      el.vehicleHint.textContent = 'Choisissez un modèle pour filtrer par motorisation.';
      return Promise.resolve();
    }

    return loadMotorizations(state.model).then(function (motorizations) {
      motorizations.forEach(function (mo) {
        var opt = node('option', null, motorOptionLabel(mo));
        opt.value = String(mo.id);
        el.motorization.appendChild(opt);
      });
      el.motorization.disabled = motorizations.length === 0;
      el.motorization.value = state.motorization;
      el.vehicleHint.textContent = motorizations.length
        ? plural(motorizations.length, 'motorisation disponible', 'motorisations disponibles')
        : 'Aucune motorisation référencée pour ce modèle.';
    });
  }

  // ---------------------------------------------------------------------
  // View switching + navigation chrome
  // ---------------------------------------------------------------------

  var VIEWS = ['viewHome', 'viewCatalogue', 'viewProduct', 'viewHelp', 'viewModels'];
  var NAV_IDS = { home: 'nav-home', cat: 'nav-catalogue', models: 'nav-models', help: 'nav-help' };

  function showView(name) {
    VIEWS.forEach(function (key) { el[key].hidden = true; });
    if (name === 'home') el.viewHome.hidden = false;
    if (name === 'cat') el.viewCatalogue.hidden = false;
    if (name === 'product') el.viewProduct.hidden = false;
    if (name === 'help') el.viewHelp.hidden = false;
    if (name === 'models') el.viewModels.hidden = false;

    Object.keys(NAV_IDS).forEach(function (key) {
      var link = document.getElementById(NAV_IDS[key]);
      if (link) link.classList.toggle('nav-active', key === name);
    });
  }

  // ---------------------------------------------------------------------
  // Home view
  // ---------------------------------------------------------------------

  var HERO_TABS = [
    { tab: 'tab-vehicle', pane: 'pane-vehicle' },
    { tab: 'tab-oem', pane: 'pane-oem' },
    { tab: 'tab-browse', pane: 'pane-browse' }
  ];

  function selectHeroTab(tabId) {
    HERO_TABS.forEach(function (t) {
      var tab = document.getElementById(t.tab);
      var pane = document.getElementById(t.pane);
      var active = t.tab === tabId;
      tab.setAttribute('aria-selected', String(active));
      pane.hidden = !active;
    });
  }

  function modelCard(m) {
    var li = node('li');
    var button = node('button', 'model-card');
    button.type = 'button';
    button.appendChild(node('span', 'model-name', m.model_name));
    button.appendChild(node('span', 'model-gen',
      (m.generation_code ? m.generation_code + ' · ' : '') + years(m.year_from, m.year_to)));
    button.appendChild(node('span', 'model-count', plural(m.product_count, 'pièce', 'pièces') + ' →'));
    button.addEventListener('click', function () {
      navigateCatalogue({ model: String(m.id), motorization: '' });
    });
    li.appendChild(button);
    return li;
  }

  function renderModelGrid(target) {
    clear(target);
    facets.models.forEach(function (m) { target.appendChild(modelCard(m)); });
  }

  function renderHomeBrands() {
    clear(el.homeBrandStrip);
    // Most-referenced brands first; the full facet lives in the catalogue.
    var top = facets.brands.slice().sort(function (a, b) {
      return b.product_count - a.product_count;
    }).slice(0, 12);
    top.forEach(function (b) {
      var li = node('li');
      var button = node('button');
      button.type = 'button';
      button.appendChild(node('span', null, b.product_brand));
      button.appendChild(node('span', 'n', b.product_count));
      button.addEventListener('click', function () {
        navigateCatalogue({ brand: b.product_brand });
      });
      li.appendChild(button);
      el.homeBrandStrip.appendChild(li);
    });
  }

  function renderHeroMotor(state) {
    clear(el.heroMotor);
    var all = node('option', null, 'Toutes les motorisations');
    all.value = '';
    el.heroMotor.appendChild(all);
    var modelId = el.heroModel.value;
    if (!modelId) { el.heroMotor.disabled = true; return Promise.resolve(); }
    return loadMotorizations(modelId).then(function (motorizations) {
      motorizations.forEach(function (mo) {
        var opt = node('option', null, motorOptionLabel(mo));
        opt.value = String(mo.id);
        el.heroMotor.appendChild(opt);
      });
      el.heroMotor.disabled = motorizations.length === 0;
    });
  }

  function renderHome(state) {
    showView('home');
    document.title = 'SsangYong Parts — Pièces détachées SsangYong & KGM en Tunisie';
    setState('');
    el.searchInput.value = state.query;
    el.heroModel.value = state.model;
    renderVehicleSummary(state);
    renderModelGrid(el.homeModelGrid);
    renderHomeBrands();
    applyWhatsAppGate('Bonjour, je cherche une pièce pour ma SsangYong.');
    return renderHeroMotor(state).then(function () {
      if (state.motorization) el.heroMotor.value = state.motorization;
    });
  }

  // ---------------------------------------------------------------------
  // Models view
  // ---------------------------------------------------------------------

  function renderModels(state) {
    showView('models');
    document.title = 'Modèles SsangYong & KGM — SsangYong Parts';
    setState('');
    renderVehicleSummary(state);
    renderModelGrid(el.modelsGrid);
    applyWhatsAppGate('Bonjour, je cherche une pièce pour ma SsangYong.');
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------
  // Assistance view
  // ---------------------------------------------------------------------

  function renderHelp(state) {
    showView('help');
    document.title = 'Assistance pièce — SsangYong Parts';
    setState('');
    renderVehicleSummary(state);
    var vehicle = vehicleText(state);
    applyWhatsAppGate(vehicle
      ? 'Bonjour, je cherche une pièce pour ma SsangYong ' + vehicle + '. '
      : 'Bonjour, je cherche une pièce pour ma SsangYong. Modèle : … Année : … Motorisation : … Référence : …');
    return Promise.resolve();
  }

  // ---------------------------------------------------------------------
  // Catalogue view
  // ---------------------------------------------------------------------

  function describeSelection(state) {
    var bits = [];
    var m = findModel(state);
    if (m) bits.push(modelLabel(m));
    var mo = findMotor(state);
    if (mo) bits.push(mo.motorisation);
    if (state.brand) bits.push(state.brand);
    if (state.avail) bits.push(state.avail);
    if (state.query) bits.push('« ' + state.query + ' »');
    return bits.join(' · ');
  }

  function productCard(p, state) {
    var li = node('li', 'card');
    var link = document.createElement('a');
    link.href = '?p=' + encodeURIComponent(p.product_uid);
    link.addEventListener('click', function (event) {
      event.preventDefault();
      writeState({ product: p.product_uid, model: state.model, motorization: state.motorization });
    });

    var photo = node('div', 'photo');
    if (p.main_image_url) {
      var img = document.createElement('img');
      img.src = p.main_image_url;
      img.alt = p.product_title;
      img.loading = 'lazy';
      // A dead image URL degrades to the same neutral state as a missing one.
      img.addEventListener('error', function () {
        clear(photo);
        photo.appendChild(node('span', 'no-photo', 'Photo non disponible'));
      });
      photo.appendChild(img);
    } else {
      photo.appendChild(node('span', 'no-photo', 'Photo non disponible'));
    }
    link.appendChild(photo);

    var body = node('div', 'body');
    body.appendChild(node('p', 'brand-line', p.product_brand));
    body.appendChild(node('h3', null, p.product_title));
    body.appendChild(node('p', 'ref', 'Réf. ' + p.canonical_reference));
    // The vehicle filter already guarantees fitment — say so on the card.
    if (state.model) body.appendChild(node('p', 'fit', '✓ Compatible avec votre véhicule'));
    body.appendChild(availabilityTag(p.availability));
    body.appendChild(node('p', 'price', money(p.price_tnd)));
    link.appendChild(body);

    li.appendChild(link);
    return li;
  }

  function availabilityTag(availability) {
    var known = { 'En Stock': 'stock', 'Sur Commande': 'order', 'Indisponible': 'order' };
    return node('p', 'tag ' + (known[availability] || 'order'), availability);
  }

  function applyListMode() {
    el.grid.classList.toggle('list-mode', listMode);
    el.viewGridBtn.setAttribute('aria-pressed', String(!listMode));
    el.viewListBtn.setAttribute('aria-pressed', String(listMode));
  }

  function renderCatalogue(state) {
    showView('cat');
    document.title = 'Catalogue pièces détachées — SsangYong Parts';
    el.searchInput.value = state.query;
    el.model.value = state.model;
    el.sort.value = state.sort;
    el.reset.hidden = !(state.model || state.motorization || state.brand || state.avail || state.query);
    applyListMode();
    renderVehicleSummary(state);

    renderBrands(state);
    renderAvailabilities(state);

    var vehicle = vehicleText(state);
    el.activeVehicle.hidden = !vehicle;
    if (vehicle) el.activeVehicle.textContent = '✓ Pièces compatibles : ' + vehicle;

    applyWhatsAppGate(vehicle
      ? 'Bonjour, je cherche une pièce pour ma SsangYong ' + vehicle + '.'
      : 'Bonjour, je cherche une pièce SsangYong.');

    var params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((state.page - 1) * PAGE_SIZE));
    if (state.query) params.set('q', state.query);
    if (state.brand) params.set('brand', state.brand);
    if (state.avail) params.set('availability', state.avail);
    if (state.sort !== 'reference') params.set('sort', state.sort);
    if (state.motorization) params.set('motorization_id', state.motorization);
    else if (state.model) params.set('model_id', state.model);

    setState('Chargement du catalogue…');
    clear(el.grid);
    el.emptyState.hidden = true;

    return Promise.all([renderMotorizations(state), api('/api/products?' + params.toString())])
      .then(function (results) {
        var data = results[1];
        setState('');
        // The motorization list resolved after vehicleText's first pass —
        // refresh the lines that name the motorisation.
        var vehicleNow = vehicleText(state);
        el.activeVehicle.hidden = !vehicleNow;
        if (vehicleNow) el.activeVehicle.textContent = '✓ Pièces compatibles : ' + vehicleNow;
        renderVehicleSummary(state);

        var selection = describeSelection(state);
        el.title.textContent = selection || 'Toutes les pièces';
        el.count.textContent = data.total === 0
          ? 'Aucun résultat'
          : plural(data.total, 'pièce', 'pièces');

        clear(el.grid);
        data.products.forEach(function (p) { el.grid.appendChild(productCard(p, state)); });

        el.emptyState.hidden = data.total !== 0;
        setWaHref('empty-whatsapp', vehicleNow
          ? 'Bonjour, je ne trouve pas une pièce pour ma SsangYong ' + vehicleNow +
            (state.query ? ' (recherche : ' + state.query + ')' : '') + '. Pouvez-vous m’aider ?'
          : 'Bonjour, je ne trouve pas la pièce que je cherche' +
            (state.query ? ' (recherche : ' + state.query + ')' : '') + '. Pouvez-vous m’aider ?');

        var pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        el.paging.hidden = pages <= 1;
        el.pageStatus.textContent = 'Page ' + state.page + ' sur ' + pages;
        el.pagePrev.disabled = state.page <= 1;
        el.pageNext.disabled = state.page >= pages;
      })
      .catch(function (err) {
        clear(el.grid);
        setState('Catalogue indisponible pour le moment (' + err.message + ').', true);
      });
  }

  // ---------------------------------------------------------------------
  // Product view
  // ---------------------------------------------------------------------

  function renderGallery(product) {
    var main = document.getElementById('product-image');
    var thumbs = document.getElementById('product-thumbs');
    clear(thumbs);

    if (product.images.length === 0) {
      main.removeAttribute('src');
      main.alt = 'Photo non disponible';
      return;
    }

    function select(index) {
      main.src = product.images[index].image_url;
      main.alt = product.images[index].image_alt || product.product_title;
      Array.prototype.forEach.call(thumbs.querySelectorAll('button'), function (b, i) {
        b.setAttribute('aria-pressed', String(i === index));
      });
    }

    if (product.images.length > 1) {
      product.images.forEach(function (image, index) {
        var li = node('li');
        var button = node('button');
        button.type = 'button';
        var img = document.createElement('img');
        img.src = image.image_url;
        img.alt = image.image_alt || (product.product_title + ' — vue ' + (index + 1));
        img.loading = 'lazy';
        button.appendChild(img);
        button.addEventListener('click', function () { select(index); });
        li.appendChild(button);
        thumbs.appendChild(li);
      });
    }
    select(0);
  }

  function renderSpecs(product) {
    var dl = document.getElementById('product-specs');
    clear(dl);
    var specs = product.technical_specs || {};

    // OE reference first when present — it is the field a mechanic matches on.
    if (product.oem_reference) {
      dl.appendChild(node('dt', null, 'Référence OE'));
      dl.appendChild(node('dd', null, product.oem_reference));
    }
    if (product.pair_reference) {
      dl.appendChild(node('dt', null, 'Référence associée'));
      dl.appendChild(node('dd', null, product.pair_reference));
    }
    Object.keys(specs).forEach(function (label) {
      dl.appendChild(node('dt', null, label));
      dl.appendChild(node('dd', null, specs[label]));
    });
    if (!dl.firstChild) {
      dl.appendChild(node('dt', null, '—'));
      dl.appendChild(node('dd', null, 'Aucune caractéristique renseignée.'));
    }
  }

  // A fitment row matches the visitor's vehicle when the URL still carries
  // their model (and, if chosen, motorization). Comparison is on catalogue
  // ids, never on names.
  function fitsVehicle(c, state) {
    if (!state.model || String(c.vehicle_model_id) !== state.model) return false;
    if (state.motorization && c.vehicle_motorization_id !== null &&
        String(c.vehicle_motorization_id) !== state.motorization) return false;
    return true;
  }

  function renderFitment(product, state) {
    var tbody = document.getElementById('product-fitment');
    clear(tbody);
    var anyFit = false;
    product.compatibility.forEach(function (c) {
      var fits = fitsVehicle(c, state);
      if (fits) anyFit = true;
      var tr = node('tr', fits ? 'fit-row' : null);
      var name = c.generation_code ? c.model_name + ' (' + c.generation_code + ')' : c.model_name;
      tr.appendChild(node('td', null, name + (fits ? ' ✓' : '')));
      tr.appendChild(node('td', null, c.motorisation));
      tr.appendChild(node('td', null, years(c.year_from, c.year_to)));
      tbody.appendChild(tr);
    });
    if (product.compatibility.length === 0) {
      var empty = node('tr');
      var td = node('td', null, 'Aucune compatibilité référencée.');
      td.colSpan = 3;
      empty.appendChild(td);
      tbody.appendChild(empty);
    }
    return anyFit;
  }

  function renderProduct(uid) {
    var state = readState();
    el.viewHome.hidden = true;
    el.viewCatalogue.hidden = true;
    el.viewHelp.hidden = true;
    el.viewModels.hidden = true;
    el.viewProduct.hidden = true;
    setState('Chargement de la pièce…');

    var loadVehicleNames = state.model ? loadMotorizations(state.model) : Promise.resolve([]);

    return Promise.all([api('/api/products/' + encodeURIComponent(uid)), loadVehicleNames])
      .then(function (results) {
        var product = results[0];
        setState('');
        showView('product');
        renderVehicleSummary(state);
        document.getElementById('product-brand').textContent = product.product_brand;
        document.getElementById('product-title').textContent = product.product_title;
        document.getElementById('crumb-p-current').textContent = product.product_title;
        document.getElementById('product-ref').textContent = product.canonical_reference;
        document.getElementById('product-price').textContent = money(product.price_tnd);

        var availability = document.getElementById('product-availability');
        availability.textContent = product.availability;
        availability.className = 'availability tag ' + (product.availability === 'En Stock' ? 'stock' : 'order');

        var delivery = document.getElementById('product-delivery');
        delivery.hidden = !product.delivery_note;
        delivery.textContent = product.delivery_note || '';

        document.getElementById('product-source').textContent = product.source;
        document.getElementById('product-checked').textContent = formatDate(product.last_checked_at);
        document.title = product.product_title + ' — SsangYong Parts';

        renderGallery(product);
        renderSpecs(product);
        var anyFit = renderFitment(product, state);

        // Data-backed only: the badge appears when the visitor's selected
        // vehicle is genuinely among this part's catalogue fitments.
        var badge = document.getElementById('product-fit-badge');
        var vehicle = vehicleText(state);
        badge.hidden = !(anyFit && vehicle);
        if (anyFit && vehicle) badge.textContent = '✓ Compatible avec votre véhicule (' + vehicle + ')';

        applyWhatsAppGate('Bonjour, cette pièce m’intéresse : ' + product.product_title +
          ' — Réf. ' + product.canonical_reference + ' (' + product.product_brand + '). Est-elle disponible ?');
      })
      .catch(function (err) {
        setState(err.message === 'HTTP 404'
          ? "Cette pièce n'existe pas ou n'est plus au catalogue."
          : 'Pièce indisponible pour le moment (' + err.message + ').', true);
      });
  }

  // ---------------------------------------------------------------------
  // Router
  // ---------------------------------------------------------------------

  function render() {
    var state = readState();
    var view = currentView(state);
    if (view === 'product') return renderProduct(state.product);
    if (view === 'help') return renderHelp(state);
    if (view === 'models') return renderModels(state);
    if (view === 'cat') return renderCatalogue(state);
    return renderHome(state);
  }

  // Intercept in-page links so navigation stays instant; the href is real, so
  // middle-click, copy-link and no-JS navigation still work.
  function bindNavLink(id, patch) {
    var link = document.getElementById(id);
    if (!link) return;
    link.addEventListener('click', function (event) {
      event.preventDefault();
      navigate(patch);
    });
  }

  function bind() {
    el.searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      navigateCatalogue({ query: el.searchInput.value.trim() });
    });

    // Hero tabs
    HERO_TABS.forEach(function (t) {
      document.getElementById(t.tab).addEventListener('click', function () {
        selectHeroTab(t.tab);
      });
    });

    // Hero vehicle finder
    el.heroModel.addEventListener('change', function () { renderHeroMotor(readState()); });
    el.heroVehicleGo.addEventListener('click', function () {
      navigateCatalogue({ model: el.heroModel.value, motorization: el.heroMotor.value });
    });

    // Hero OEM search
    el.heroOemForm.addEventListener('submit', function (event) {
      event.preventDefault();
      navigateCatalogue({ query: el.heroOemInput.value.trim() });
    });

    // Catalogue filters
    el.model.addEventListener('change', function () {
      // A new model invalidates the motorization chosen under the old one.
      navigateCatalogue({ model: el.model.value, motorization: '' });
    });
    el.motorization.addEventListener('change', function () {
      navigateCatalogue({ motorization: el.motorization.value });
    });
    el.sort.addEventListener('change', function () {
      navigateCatalogue({ sort: el.sort.value });
    });
    el.reset.addEventListener('click', function () {
      navigateCatalogue({ model: '', motorization: '', brand: '', avail: '', query: '' });
    });

    // Grid / list toggle — presentation only, not URL state
    el.viewGridBtn.addEventListener('click', function () { listMode = false; applyListMode(); });
    el.viewListBtn.addEventListener('click', function () { listMode = true; applyListMode(); });

    // Mobile filter drawer — presentation only, not URL state
    var filtersToggle = document.getElementById('filters-toggle');
    var filtersPanel = document.getElementById('filters-panel');
    filtersToggle.addEventListener('click', function () {
      var open = filtersToggle.getAttribute('aria-expanded') === 'true';
      filtersToggle.setAttribute('aria-expanded', String(!open));
      filtersPanel.classList.toggle('open', !open);
    });

    // Empty-state recovery — the user is never left blocked
    document.getElementById('empty-reset').addEventListener('click', function () {
      navigateCatalogue({ model: '', motorization: '', brand: '', avail: '', query: '' });
    });
    document.getElementById('empty-change-vehicle').addEventListener('click', function () {
      navigate({ view: '', model: '', motorization: '', brand: '', avail: '', query: '', product: null });
    });
    document.getElementById('empty-oem').addEventListener('click', function () {
      navigate({ view: '', brand: '', avail: '', query: '', product: null });
    });

    // Paging
    el.pagePrev.addEventListener('click', function () {
      var state = readState();
      if (state.page > 1) writeState(Object.assign(state, { page: state.page - 1 }));
    });
    el.pageNext.addEventListener('click', function () {
      var state = readState();
      writeState(Object.assign(state, { page: state.page + 1 }));
    });

    // Chrome links that stay inside the app
    bindNavLink('brand-home', { view: '', product: null });
    bindNavLink('nav-home', { view: '', product: null });
    bindNavLink('nav-catalogue', { view: 'cat', product: null });
    bindNavLink('nav-models', { view: 'models', product: null });
    bindNavLink('nav-oem', { view: 'cat', product: null });
    bindNavLink('nav-help', { view: 'aide', product: null });
    bindNavLink('home-models-all', { view: 'models' });
    bindNavLink('home-brands-all', { view: 'cat' });
    bindNavLink('hero-browse-go', { view: 'cat' });
    bindNavLink('hero-models-go', { view: 'models' });
    bindNavLink('home-assist-go', { view: 'aide' });
    bindNavLink('crumb-home', { view: '', product: null });
    bindNavLink('crumb-p-home', { view: '', product: null });
    bindNavLink('crumb-h-home', { view: '', product: null });
    bindNavLink('crumb-m-home', { view: '', product: null });
    bindNavLink('back-link', { view: 'cat', product: null });
    bindNavLink('product-assist', { view: 'aide', product: null });
    bindNavLink('empty-assist', { view: 'aide', product: null });
    bindNavLink('help-open-cat', { view: 'cat' });
    bindNavLink('help-open-models', { view: 'models' });
    bindNavLink('footer-cat', { view: 'cat', product: null });
    bindNavLink('footer-models', { view: 'models', product: null });
    bindNavLink('footer-oem', { view: 'cat', product: null });
    bindNavLink('footer-help', { view: 'aide', product: null });
    bindNavLink('action-vehicle', { view: 'cat', product: null });

    window.addEventListener('popstate', render);
  }

  setState('Chargement…');
  loadFacets()
    .then(function () {
      bind();
      render();
    })
    .catch(function (err) {
      setState('Le catalogue est injoignable (' + err.message + '). Réessayez plus tard.', true);
    });
})();
