// BACKEND FOR NEXA AUTO HUB
const API_URL = "https://script.google.com/macros/s/AKfycbykjoJTBPOSVlL9vqPDuR8MVxAvWk7rqEqZWb7QZfKnRmwl9rszyIqjE-GDWN30eJ_P/exec";

// Get ALL products from Google Sheet
async function getAllProducts() {
  const res = await fetch(API_URL);
  const data = await res.json();
  // Convert sheet rows to nice objects
  let products = [];
  for (let i = 1; i < data.length; i++) {
    products.push({
      name: data[i][0],
      stock: data[i][1],
      price: data[i][2]
    });
  }
  return products;
}

// Buy a product - updates Sheet for everybody
async function buyProduct(productName, qty = 1) {
  await fetch(API_URL + "?product=" + productName + "&qty=" + qty, { method: "POST" });
  return true;
}

// Show products on website
async function showProducts() {
  const products = await getAllProducts();
  let html = "";
  products.forEach(p => {
    html += `
      <div style="border:1px solid #ccc; padding:15px; margin:10px; border-radius:10px;">
        <h3>${p.name}</h3>
        <p>Price: GH₵ ${p.price}</p>
        <p>Stock: <b>${p.stock}</b></p>
        <button onclick="handleBuy('${p.name}')" ${p.stock <= 0 ? 'disabled' : ''}>
          ${p.stock <= 0 ? 'Out of Stock' : 'Buy 1'}
        </button>
      </div>
    `;
  });
  document.getElementById("products").innerHTML = html;
}

async function handleBuy(name) {
  await buyProduct(name, 1);
  alert(name + " bought!");
  showProducts();
}