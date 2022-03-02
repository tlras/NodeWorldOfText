var download_busy = {};
var intv;

module.exports.startup_internal = function(vars) {
	intv = vars.intv;

	// periodically clear the list in case of a bug
	intv.downloadBusyCheck = setInterval(function() {
		for(var i in download_busy) {
			delete download_busy[i];
		}
	}, 1000 * 60 * 5);
}

async function iterateWorld(db, worldId, onTile) {
	var groupSize = 2048;
	var posY = -9007199254740991;
	// relies on the following index schema to work properly: (..., tileY, tileX), in ascending order
	while(true) {
		var td = await db.all("SELECT * FROM tile WHERE world_id=? AND tileY >= ? LIMIT ?", [worldId, posY, groupSize]);
		for(var t = 0; t < td.length; t++) {
			var resp = await onTile(td[t]);
			if(resp === false) return;
		}
		if(td.length < groupSize) { // no more tiles left in world
			return;
		}
		var lastTile = td[td.length - 1];
		var ltx = lastTile.tileX;
		var lty = lastTile.tileY;
		var posX = ltx + 1;
		while(true) {
			var rtd = await db.all("SELECT * FROM tile WHERE world_id=? AND tileY=? and tileX >= ? LIMIT ?", [worldId, lty, posX, groupSize]);
			for(var t = 0; t < rtd.length; t++) {
				var resp = await onTile(rtd[t]);
				if(resp === false) return;
			}
			if(rtd.length < groupSize) { // no more tiles left in row
				break;
			}
			var lastRowTile = rtd[rtd.length - 1];
			var rltx = lastRowTile.tileX;
			posX = rltx + 1;
		}
		posY = lty + 1;
	}
}

module.exports.GET = async function(req, serve, vars, evars) {
	var path = evars.path;
	var user = evars.user;
	var setCallback = evars.setCallback;

	var dispage = vars.dispage;
	var checkURLParam = vars.checkURLParam;
	var db = vars.db;
	var filename_sanitize = vars.filename_sanitize;
	var getOrCreateWorld = vars.getOrCreateWorld;
	var releaseWorld = vars.releaseWorld;

	var world_name = checkURLParam("/accounts/download/*world", path).world;

	var world = await getOrCreateWorld(world_name);
	if(!world) {
		return await dispage("404", null, req, serve, vars, evars);
	}

	setCallback(function() {
		releaseWorld(world);
		delete download_busy[user.id];
	});

	// not a superuser nor owner
	var is_owner = world.ownerId == user.id;
	if(!(user.superuser || is_owner)) {
		return await dispage("404", null, req, serve, vars, evars);
	}

	if(is_owner && !user.superuser) {
		if(download_busy[user.id]) {
			return serve("You are already downloading a world. Please wait.");
		} else {
			download_busy[user.id] = true;
		}
	}

	serve.startStream();

	// set up headers
	serve(null, null, {
		mime: "application/force-download; charset=utf-8",
		download_file: filename_sanitize("World_" + world_name + ".json")
	});

	var firstTile = true;
	async function procTile(tile) {
		var data = JSON.stringify({
			content: tile.content,
			tileX: tile.tileX,
			tileY: tile.tileY,
			properties: tile.properties,
			writability: tile.writability,
			created_at: tile.created_at
		});
		if(!firstTile) data = "," + data;
		firstTile = false;
		if(await serve.writeStream(data)) return false; // aborted
	}

	if(await serve.writeStream("[")) return;
	await iterateWorld(db, world.id, procTile);
	if(await serve.writeStream("]")) return;

	serve.endStream();
}