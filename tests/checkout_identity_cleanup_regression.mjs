import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `Existe ${name}.`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const character = source[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === quote) {
        quote = '';
      }
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}' && --depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  assert.fail(`No se pudo cerrar ${name}.`);
}

const clearSensitiveSource = extractFunction(index, 'clearCheckoutSensitiveFields');
const closeCheckoutSource = extractFunction(index, 'closeCheckout');
assert.doesNotMatch(clearSensitiveSource, /\b(?:fetch|XMLHttpRequest|sendBeacon|supabase|\.rpc\s*\(|\.from\s*\()/i,
  'La limpieza de identidad no hace llamadas remotas ni toca Supabase.');
assert.match(clearSensitiveSource, /customerCedula/);
assert.match(clearSensitiveSource, /customerCedulaType/);

const fields = {
  customerCedula: { value: '123456789' },
  customerCedulaType: { value: 'CC' },
  customerName: { value: 'Comprador sintético' },
};
const modal = {
  classList: {
    removed: [],
    remove(value) { this.removed.push(value); },
  },
};
const body = { style: { overflow: 'hidden' } };
const context = vm.createContext({
  $: id => id === 'checkoutModal' ? modal : fields[id] || null,
  document: { body },
  checkoutCart: { id: 'synthetic-cart' },
});
vm.runInContext(`${clearSensitiveSource}\n${closeCheckoutSource}`, context);

// Un click dentro del contenido no debe cerrar ni borrar datos a mitad de edición.
context.closeCheckout({ target: {} });
assert.equal(fields.customerCedula.value, '123456789');
assert.equal(fields.customerCedulaType.value, 'CC');
assert.deepEqual(modal.classList.removed, []);
assert.equal(context.checkoutCart.id, 'synthetic-cart');

// El backdrop sí cierra y elimina la identidad introducida en el navegador.
context.closeCheckout({ target: modal });
assert.equal(fields.customerCedula.value, '');
assert.equal(fields.customerCedulaType.value, '');
assert.equal(fields.customerName.value, 'Comprador sintético', 'La limpieza queda limitada a identidad documental.');
assert.deepEqual(modal.classList.removed, ['open']);
assert.equal(context.checkoutCart, null);
assert.equal(body.style.overflow, '');

// El botón Cancelar/Escape también usa la ruta sin evento.
fields.customerCedula.value = '987654321';
fields.customerCedulaType.value = 'CE';
context.closeCheckout();
assert.equal(fields.customerCedula.value, '');
assert.equal(fields.customerCedulaType.value, '');

console.log('PASS checkout_identity_cleanup_regression: la cédula/tipo no sobreviven al cierre del checkout y el flujo no hace red ni mutaciones.');
