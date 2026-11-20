// QA Shop - code that runs in the browser.

let products = [];
let cart = []; // each item: { id, name, price, quantity }
let discountRate = 0;

const $ = (id) => document.getElementById(id);

// ---------- Products & search ----------
async function loadProducts() {
  const response = await fetch("/api/products");
  products = await response.json();
  renderProducts(products);
}

function renderProducts(list) {
  const ul = $("product-list");
  ul.innerHTML = "";
  for (const p of list) {
    const li = document.createElement("li");
    li.dataset.testid = "product-item";
    li.innerHTML = `
      <span data-testid="product-name">${p.name}</span>
      <span data-testid="product-price">$${p.price.toFixed(2)}</span>
      <button data-testid="add-to-cart" data-id="${p.id}">Add to cart</button>`;
    ul.appendChild(li);
  }
  ul.querySelectorAll("[data-testid=add-to-cart]").forEach((btn) =>
    btn.addEventListener("click", () => addToCart(Number(btn.dataset.id)))
  );
}

$("search").addEventListener("input", (event) => {
  const term = event.target.value;
  const found = products.filter((p) => p.name.includes(term));
  renderProducts(found);
  $("search-message").innerHTML =
    found.length === 0 ? `No results for "${term}"` : "";
});

// ---------- Cart ----------
function addToCart(id) {
  const existing = cart.find((item) => item.id === id);
  if (existing) {
    existing.quantity += 1;
  } else {
    const p = products.find((prod) => prod.id === id);
    cart.push({ id: p.id, name: p.name, price: p.price, quantity: 1 });
  }
  renderCart();
}

function changeQuantity(index, delta) {
  cart[index].quantity += delta;
  renderCart();
}

function removeFromCart(index) {
  cart.splice(index + 1, 1);
  renderCart();
}

function cartTotal() {
  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
  return subtotal * (1 - discountRate);
}

function renderCart() {
  const ul = $("cart-list");
  ul.innerHTML = "";
  cart.forEach((item, index) => {
    const li = document.createElement("li");
    li.dataset.testid = "cart-item";
    li.innerHTML = `
      <span data-testid="cart-item-name">${item.name}</span>
      <span class="qty">
        <button class="small" data-testid="qty-minus">-</button>
        <span data-testid="cart-item-qty">${item.quantity}</span>
        <button class="small" data-testid="qty-plus">+</button>
      </span>
      <button class="small" data-testid="remove-item">Remove</button>`;
    li.querySelector("[data-testid=qty-minus]").onclick = () => changeQuantity(index, -1);
    li.querySelector("[data-testid=qty-plus]").onclick = () => changeQuantity(index, +1);
    li.querySelector("[data-testid=remove-item]").onclick = () => removeFromCart(index);
    ul.appendChild(li);
  });
  $("cart-total").textContent = cartTotal().toFixed(2);
}

$("apply-discount").addEventListener("click", () => {
  const code = $("discount").value.trim().toUpperCase();
  if (code === "SAVE10") discountRate = 0.01;
  renderCart();
});

// ---------- Login ----------
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: $("username").value, password: $("password").value }),
  });
  const data = await response.json();
  $("login-message").textContent = data.message;
});

// ---------- Checkout ----------
function isValidEmail(email) {
  return email.includes(".");
}

$("checkout-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const email = $("email").value.trim();
  if (cart.length === 0) {
    $("checkout-message").textContent = "Your cart is empty";
  } else if (!isValidEmail(email)) {
    $("checkout-message").textContent = "Please enter a valid email";
  } else {
    $("checkout-message").textContent = `Order placed! Confirmation sent to ${email}`;
    cart = [];
    renderCart();
  }
});

loadProducts();

// ---------- My account: password + 2FA code, passkeys, sessions ----------
let codeTicket = null;

async function postJson(url, body = {}) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return response.json();
}

async function refreshAccount() {
  const me = await fetch("/api/account/me").then((r) => r.json());
  $("account-status").textContent = me.signedIn ? `Signed in as ${me.username}` : "Not signed in";
  $("account-form").hidden = me.signedIn;
  $("code-form").hidden = me.signedIn || !codeTicket;
  $("passkey-login").hidden = me.signedIn;
  $("passkey-create").hidden = !me.signedIn;
  $("account-logout").hidden = !me.signedIn;
}

$("account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await postJson("/api/account/login", { username: $("account-username").value, password: $("account-password").value });
  $("account-message").textContent = data.message;
  codeTicket = data.needsCode ? data.ticket : null;
  $("code-form").hidden = !codeTicket;
  if (codeTicket) $("account-code").focus();
});

$("code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await postJson("/api/account/verify-code", { ticket: codeTicket, code: $("account-code").value.trim() });
  $("account-message").textContent = data.message;
  if (data.ok) codeTicket = null;
  await refreshAccount();
});

$("account-logout").addEventListener("click", async () => {
  const data = await postJson("/api/account/logout");
  $("account-message").textContent = data.message;
  await refreshAccount();
});

$("passkey-create").addEventListener("click", async () => {
  try {
    const { challengeId, options } = await postJson("/api/passkey/register/options");
    const credential = await navigator.credentials.create({ publicKey: PublicKeyCredential.parseCreationOptionsFromJSON(options) });
    const data = await postJson("/api/passkey/register/verify", { challengeId, response: credential.toJSON() });
    $("account-message").textContent = data.message;
  } catch {
    $("account-message").textContent = "Could not create the passkey";
  }
});

$("passkey-login").addEventListener("click", async () => {
  try {
    const { challengeId, options } = await postJson("/api/passkey/login/options");
    const credential = await navigator.credentials.get({ publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options) });
    const data = await postJson("/api/passkey/login/verify", { challengeId, response: credential.toJSON() });
    $("account-message").textContent = data.message;
  } catch {
    $("account-message").textContent = "Passkey sign-in was cancelled or failed";
  }
  await refreshAccount();
});

refreshAccount();
