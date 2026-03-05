// Deliberately buggy API for testing Havoc
// Each bug is tagged with a comment so we know what Havoc should find

import express from "express";

const app = express();
app.use(express.json());

// In-memory store
let products = [
  { id: "1", name: "Widget", price: 9.99, category: "tools", stock: 100 },
  { id: "2", name: "Gadget", price: 24.99, category: "electronics", stock: 50 },
  { id: "3", name: "Doohickey", price: 4.99, category: "tools", stock: 200 },
];
let orders = [];
let nextProductId = 4;
let nextOrderId = 1;

// ─── Products ───────────────────────────────────────────

// GET /products — list with optional filters
app.get("/products", (req, res) => {
  let result = [...products];

  if (req.query.category) {
    // BUG: case-sensitive filter — "Tools" won't match "tools"
    result = result.filter((p) => p.category === req.query.category);
  }

  if (req.query.sort === "price_asc") {
    result.sort((a, b) => a.price - b.price);
  } else if (req.query.sort === "price_desc") {
    // BUG: sort is ascending instead of descending
    result.sort((a, b) => a.price - b.price);
  }

  if (req.query.limit) {
    const limit = parseInt(req.query.limit);
    // BUG: no validation on limit — negative values, NaN accepted
    result = result.slice(0, limit);
  }

  // BUG: returns 200 with count field that doesn't match actual items
  res.json({
    items: result,
    count: products.length, // should be result.length
    total: products.length,
  });
});

// GET /products/:id
app.get("/products/:id", (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) {
    // BUG: returns 200 with null instead of 404
    return res.json(null);
  }
  res.json(product);
});

// POST /products
app.post("/products", (req, res) => {
  const { name, price, category, stock } = req.body;

  // BUG: no validation — missing name, negative price, etc. all accepted
  if (!name) {
    // BUG: returns 200 with error message instead of 400
    return res.json({ error: "Name is required" });
  }

  // BUG: price_override in body is silently accepted and used
  const finalPrice = req.body.price_override ?? price;

  const product = {
    id: String(nextProductId++),
    name,
    price: finalPrice,
    category: category || "uncategorized",
    stock: stock ?? 0,
  };

  products.push(product);

  // BUG: returns the product but with price as string sometimes
  res.status(201).json({
    ...product,
    price: finalPrice <= 0 ? String(finalPrice) : finalPrice,
  });
});

// PUT /products/:id
app.put("/products/:id", (req, res) => {
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: "Not found" });
  }

  // BUG: no type checking — can set price to a string, stock to negative
  products[idx] = { ...products[idx], ...req.body };
  res.json(products[idx]);
});

// DELETE /products/:id
app.delete("/products/:id", (req, res) => {
  const idx = products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    // BUG: returns 200 on delete of non-existent resource
    return res.json({ deleted: true });
  }
  products.splice(idx, 1);
  res.json({ deleted: true });
});

// ─── Orders ─────────────────────────────────────────────

// POST /orders
app.post("/orders", (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: "Items array required" });
  }

  // BUG: no validation that product IDs exist
  // BUG: no validation that quantity > 0
  const orderItems = items.map((item) => {
    const product = products.find((p) => p.id === item.product_id);
    return {
      product_id: item.product_id,
      quantity: item.quantity,
      price: product ? product.price : 0, // BUG: price 0 for missing products instead of error
      name: product?.name ?? "Unknown",
    };
  });

  // BUG: total calculation uses floating point without rounding
  const total = orderItems.reduce((sum, i) => sum + i.price * i.quantity, 0);

  const order = {
    id: String(nextOrderId++),
    items: orderItems,
    total, // BUG: not rounded — could be 34.980000000000004
    status: "pending",
    created_at: new Date().toISOString(),
  };

  orders.push(order);
  res.status(201).json(order);
});

// GET /orders/:id
app.get("/orders/:id", (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Not found" });
  }
  res.json(order);
});

// POST /orders/:id/ship
app.post("/orders/:id/ship", (req, res) => {
  const order = orders.find((o) => o.id === req.params.id);
  if (!order) {
    return res.status(404).json({ error: "Not found" });
  }

  // BUG: can ship an already shipped order
  // BUG: no tracking number generated for shipped orders
  order.status = "shipped";
  res.json(order);
});

// ─── Crash triggers ─────────────────────────────────────

// BUG: deeply nested objects cause stack overflow
app.post("/products/:id/metadata", (req, res) => {
  const product = products.find((p) => p.id === req.params.id);
  if (!product) {
    return res.status(404).json({ error: "Not found" });
  }

  // BUG: recursively processes nested objects without depth limit
  function countKeys(obj) {
    if (typeof obj !== "object" || obj === null) return 0;
    let count = 0;
    for (const val of Object.values(obj)) {
      count += 1 + countKeys(val);
    }
    return count;
  }

  const keyCount = countKeys(req.body);
  product.metadata = req.body;
  product.metadata_keys = keyCount;
  res.json(product);
});

// ─── Health ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// ─── Error handler ──────────────────────────────────────

// BUG: error handler leaks stack traces
app.use((err, _req, res, _next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Buggy test server running on http://localhost:${PORT}`);
});

export default app;
