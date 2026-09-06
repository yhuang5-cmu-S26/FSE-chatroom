const weather = require('./weather');

const servers = new Map([[weather.server.name, weather.server]]);
const actionRoutes = new Map(Object.entries({ ...weather.actions }));

function getMcpServer(name) { return servers.get(name) || null; }
function getActionRoute(action) { return actionRoutes.get(action) || null; }
function isActionEnabled(action) {
  const route = getActionRoute(action);
  return Boolean(route && getMcpServer(route.server)?.url);
}

module.exports = { getMcpServer, getActionRoute, isActionEnabled };
