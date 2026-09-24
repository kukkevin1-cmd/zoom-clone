const { createApp } = require("./app");

const PORT = process.env.PORT || 3000;
const { httpServer } = createApp();

httpServer.listen(PORT, () => {
  console.log(`Zoom clone listening on http://localhost:${PORT}`);
});
