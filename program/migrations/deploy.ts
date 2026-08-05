// Migrations are an early feature. Currently, they're nothing more than this
// temporary script. In the future, they'll be what deploy scripts are in
// Hardhat.
const anchor = require("@coral-xyz/anchor");

module.exports = async function (provider) {
  anchor.setProvider(provider);
};
