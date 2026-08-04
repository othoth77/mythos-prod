// Generic modal entity helpers extraction (Stage 4X).
// Dependencies: num (app.js); browser DOM; entity STORE readers/writers passed as callbacks.

function fillModalFields(prefix, item, fields) {
  document.getElementById(prefix + '-edit-id').value = item?.id || '';
  const keyMap = { 'supplier-id': 'supplierId', 'supplier-name': 'supplierName', 'linked-bank': 'linkedBank' };
  fields.forEach(field => {
    const el = document.getElementById(prefix + '-' + field);
    const key = keyMap[field] || field.replace('-', '');
    if (el) {
      if (el.type === 'checkbox') {
        el.checked = item ? (item[key] ?? item[field] ?? false) : false;
      } else {
        el.value = item ? (item[key] ?? item[field] ?? '') : '';
      }
    }
  });
}

function saveModalEntity(prefix, getFn, saveFn, fields, renderFn, closeFn) {
  const id = document.getElementById(prefix + '-edit-id').value || prefix + '_' + Date.now();
  const item = { id };
  const keyMap = { 'supplier-id': 'supplierId', 'supplier-name': 'supplierName', 'linked-bank': 'linkedBank' };
  fields.forEach(field => {
    const el = document.getElementById(prefix + '-' + field);
    const key = keyMap[field] || field.replace('-', '');
    if (el?.type === 'checkbox') {
      item[key] = el.checked;
    } else {
      item[key] = el?.type === 'number' ? num(el.value) : (el?.value || '');
    }
  });
  let items = getFn();
  items = items.some(x => x.id === id) ? items.map(x => x.id === id ? item : x) : items.concat(item);
  saveFn(items);
  closeFn();
  renderFn();
}
