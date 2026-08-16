'use strict';
// =====================================================
// MYTHOS — SsangYong Parts storefront — SYA-SHOP-1
// projects/ssangyong-autos/reference/shop-ui.js
//
// The storefront ratified as migration-plan §22 option 3: it consumes the
// SYA-API-1 catalog API natively and touches nothing else. No framework, no
// build step, no bundler — the same plain-DOM convention as
// projects/idauto/reference/admin-ui.js, and it runs under the CSP api.js
// sends (`script-src 'self'`), so there is no inline handler anywhere.
//
// TEXT IS NEVER INTERPOLATED INTO HTML. Every catalog string — titles,
// criteria, spec labels — originates from a scraped third-party site and is
// therefore untrusted. This file builds nodes and assigns textContent; there
// is no innerHTML assignment carrying catalog data, so a crafted product
// title cannot become markup.
//
// State lives in the query string (?p / ?model / ?motor / ?brand / ?q / ?page)
// so a filtered catalogue and a product page are both linkable and
// back-button-correct. That mirrors how the existing SSANGYONG storefront
// already models its own state.
// =====================================================

(function () {
  var PAGE_SIZE = 24;

  var el = {
    viewCatalogue: document.getElementById('view-catalogue'),
    viewProduct: document.getElementById('view-product'),
    state: document.getElementById('state-message'),
    searchForm: document.getElementById('search-form'),
    searchInput: document.getElementById('search-input'),
    model: document.getElementById('filter-model'),
    motorization: document.getElementById('filter-motorization'),
    vehicleHint: document.getElementById('vehicle-hint'),
    brands: document.getElementById('filter-brands'),
    reset: document.getElementById('filter-reset'),
    title: document.getElementById('results-title'),
    count: document.getElementById('results-count'),
    grid: document.getElementById('product-grid'),
    paging: document.getElementById('paging'),
    pagePrev: document.getElementById('page-prev'),
    pageNext: document.getElementById('page-next'),
    pageStatus: document.getElementById('page-status'),
    footerCounts: document.getElementById('footer-counts')
  };

  var facets = { models: [], brands: [] };
  var motorizationCache = {};

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
    var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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

  function readState() {
    var p = new URLSearchParams(window.location.search);
    var page = parseInt(p.get('page') || '1', 10);
    return {
      product: p.get('p') || null,
      model: p.get('model') || '',
      motorization: p.get('motor') || '',
      brand: p.get('brand') || '',
      query: p.get('q') || '',
      page: Number.isFinite(page) && page > 0 ? page : 1
    };
  }

  function writeState(next, replace) {
    var p = new URLSearchParams();
    if (next.product) {
      p.set('p', next.product);
    } else {
      if (next.model) p.set('model', next.model);
      if (next.motorization) p.set('motor', next.motorization);
      if (next.brand) p.set('brand', next.brand);
      if (next.query) p.set('q', next.query);
      if (next.page > 1) p.set('page', String(next.page));
    }
    var qs = p.toString();
    var url = window.location.pathname + (qs ? '?' + qs : '');
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    render();
  }

  function navigate(patch) {
    var next = Object.assign(readState(), patch);
    // Any filter change invalidates the current page number — staying on
    // page 4 of a result set that now has one page shows an empty grid.
    if (!('page' in patch)) next.page = 1;
    writeState(next);
  }

  // ---------------------------------------------------------------------
  // Facets
  // ---------------------------------------------------------------------

  function loadFacets() {
    return Promise.all([api('/api/vehicle-models'), api('/api/brands'), api('/api/health')])
      .then(function (results) {
        facets.models = results[0].vehicle_models;
        facets.brands = results[1].brands;
        var c = results[2].counts;
        el.footerCounts.textContent =
          plural(c.products, 'pièce référencée', 'pièces référencées') + ' · ' +
          plural(c.vehicle_models, 'modèle', 'modèles') + ' · ' +
          plural(c.vehicle_motorizations, 'motorisation', 'motorisations');

        facets.models.forEach(function (m) {
          var opt = node('option', null, modelLabel(m) + ' (' + m.product_count + ')');
          opt.value = String(m.id);
          el.model.appendChild(opt);
        });
      });
  }

  function renderBrands(state) {
    clear(el.brands);
    facets.brands.forEach(function (b) {
      var li = node('li');
      var button = node('button');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(state.brand === b.product_brand));
      button.appendChild(node('span', null, b.product_brand));
      button.appendChild(node('span', 'n', b.product_count));
      button.addEventListener('click', function () {
        navigate({ brand: state.brand === b.product_brand ? '' : b.product_brand });
      });
      li.appendChild(button);
      el.brands.appendChild(li);
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
        var label = mo.motorisation + ' · ' + years(mo.year_from, mo.year_to);
        if (mo.fuel) label += ' · ' + mo.fuel;
        var opt = node('option', null, label + ' (' + mo.product_count + ')');
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
  // Catalogue view
  // ---------------------------------------------------------------------

  function describeSelection(state) {
    var bits = [];
    if (state.model) {
      var m = facets.models.filter(function (x) { return String(x.id) === state.model; })[0];
      if (m) bits.push(modelLabel(m));
    }
    if (state.motorization && motorizationCache[state.model]) {
      var mo = motorizationCache[state.model].filter(function (x) { return String(x.id) === state.motorization; })[0];
      if (mo) bits.push(mo.motorisation);
    }
    if (state.brand) bits.push(state.brand);
    if (state.query) bits.push('« ' + state.query + ' »');
    return bits.join(' · ');
  }

  function productCard(p) {
    var li = node('li', 'card');
    var link = document.createElement('a');
    link.href = '?p=' + encodeURIComponent(p.product_uid);
    link.addEventListener('click', function (event) {
      event.preventDefault();
      writeState({ product: p.product_uid });
    });

    var photo = node('div', 'photo');
    if (p.main_image_url) {
      var img = document.createElement('img');
      img.src = p.main_image_url;
      img.alt = p.product_title;
      img.loading = 'lazy';
      photo.appendChild(img);
    } else {
      photo.appendChild(node('span', 'no-photo', 'Photo non disponible'));
    }
    link.appendChild(photo);

    var body = node('div', 'body');
    body.appendChild(node('p', 'brand-line', p.product_brand));
    body.appendChild(node('h3', null, p.product_title));
    body.appendChild(node('p', 'ref', 'Réf. ' + p.canonical_reference));
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

  function renderCatalogue(state) {
    el.viewProduct.hidden = true;
    el.viewCatalogue.hidden = false;
    el.searchInput.value = state.query;
    el.model.value = state.model;
    el.reset.hidden = !(state.model || state.motorization || state.brand || state.query);

    renderBrands(state);

    var params = new URLSearchParams();
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String((state.page - 1) * PAGE_SIZE));
    if (state.query) params.set('q', state.query);
    if (state.brand) params.set('brand', state.brand);
    if (state.motorization) params.set('motorization_id', state.motorization);
    else if (state.model) params.set('model_id', state.model);

    setState('Chargement du catalogue…');
    clear(el.grid);

    return Promise.all([renderMotorizations(state), api('/api/products?' + params.toString())])
      .then(function (results) {
        var data = results[1];
        setState('');

        var selection = describeSelection(state);
        el.title.textContent = selection || 'Toutes les pièces';
        el.count.textContent = data.total === 0
          ? 'Aucun résultat'
          : plural(data.total, 'pièce', 'pièces');

        clear(el.grid);
        data.products.forEach(function (p) { el.grid.appendChild(productCard(p)); });

        if (data.total === 0) {
          setState('Aucune pièce ne correspond à ces critères. Élargissez la recherche ou effacez les filtres.');
        }

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
    Object.keys(specs).forEach(function (label) {
      dl.appendChild(node('dt', null, label));
      dl.appendChild(node('dd', null, specs[label]));
    });
    if (!dl.firstChild) {
      dl.appendChild(node('dt', null, '—'));
      dl.appendChild(node('dd', null, 'Aucune caractéristique renseignée.'));
    }
  }

  function renderFitment(product) {
    var tbody = document.getElementById('product-fitment');
    clear(tbody);
    product.compatibility.forEach(function (c) {
      var tr = node('tr');
      var name = c.generation_code ? c.model_name + ' (' + c.generation_code + ')' : c.model_name;
      tr.appendChild(node('td', null, name));
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
  }

  function renderProduct(uid) {
    el.viewCatalogue.hidden = true;
    el.viewProduct.hidden = true;
    setState('Chargement de la pièce…');

    return api('/api/products/' + encodeURIComponent(uid))
      .then(function (product) {
        setState('');
        el.viewProduct.hidden = false;
        document.getElementById('product-brand').textContent = product.product_brand;
        document.getElementById('product-title').textContent = product.product_title;
        document.getElementById('product-ref').textContent = product.canonical_reference;
        document.getElementById('product-price').textContent = money(product.price_tnd);

        var availability = document.getElementById('product-availability');
        availability.textContent = product.availability;
        availability.className = 'availability tag ' + (product.availability === 'En Stock' ? 'stock' : 'order');

        document.getElementById('product-source').textContent = product.source;
        document.getElementById('product-checked').textContent = formatDate(product.last_checked_at);
        document.title = product.product_title + ' — SsangYong Parts';

        renderGallery(product);
        renderSpecs(product);
        renderFitment(product);
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
    if (state.product) return renderProduct(state.product);
    document.title = 'SsangYong Parts — Catalogue pièces détachées';
    return renderCatalogue(state);
  }

  function bind() {
    el.searchForm.addEventListener('submit', function (event) {
      event.preventDefault();
      navigate({ query: el.searchInput.value.trim(), product: null });
    });

    el.model.addEventListener('change', function () {
      // A new model invalidates the motorization chosen under the old one.
      navigate({ model: el.model.value, motorization: '' });
    });

    el.motorization.addEventListener('change', function () {
      navigate({ motorization: el.motorization.value });
    });

    el.reset.addEventListener('click', function () {
      navigate({ model: '', motorization: '', brand: '', query: '' });
    });

    el.pagePrev.addEventListener('click', function () {
      var state = readState();
      if (state.page > 1) writeState(Object.assign(state, { page: state.page - 1 }));
    });

    el.pageNext.addEventListener('click', function () {
      var state = readState();
      writeState(Object.assign(state, { page: state.page + 1 }));
    });

    document.getElementById('back-link').addEventListener('click', function (event) {
      event.preventDefault();
      writeState({ product: null, page: 1 });
    });

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
