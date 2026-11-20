// Serves the built portfolio (dist/) at http://localhost:4000 so you can see it before publishing.
// Run it with:  npm run portfolio:preview

import express from "express";

const app = express();
app.use(express.static("dist"));
app.listen(4000, () => console.log("Portfolio preview at http://localhost:4000"));
