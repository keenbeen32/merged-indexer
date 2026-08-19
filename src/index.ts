/** Merged indexer entry point. Each import registers its handlers on load. */
import "./farm/handlers/EternalFarming.js";
import "./farm/handlers/NonfungiblePositionManager.js";

import "./analytics/handlers/Factory.js";
import "./analytics/handlers/NonfungiblePositionManager.js";
import "./analytics/handlers/Pool.js";

import "./helper/handlers/VoterV5.js";
import "./helper/handlers/GaugeV2.js";
import "./helper/handlers/Options.js";
import "./helper/handlers/PreMining.js";
import "./helper/handlers/VeToken.js";
import "./helper/handlers/Blocks.js";

import "./v1/factory.js";
import "./v1/core.js";

import "./v4/handlers/PoolManager.js";
import "./v4/handlers/PositionManager.js";
