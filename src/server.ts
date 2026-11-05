import app from "./app.js";
// Trusted single-user prototype. Public exposure requires authentication and an
// egress-controlled remote acquisition policy; do not reverse-proxy this server.
app.listen(5000, "127.0.0.1", () => console.log("CodeAtlas listening on http://127.0.0.1:5000"));
