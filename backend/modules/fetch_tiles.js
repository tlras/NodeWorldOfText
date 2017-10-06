module.exports = async function(data, vars) {
    var db = vars.db;
    var user = vars.user;
    var san_nbr = vars.san_nbr;
    var xrange = vars.xrange;
    var world = vars.world;
    var timemachine = vars.timemachine;
    if(!timemachine) timemachine = {};

    var tiles = {};

    var len = data.fetchRectangles.length
    for(var i = 0; i < len; i++) {
        var rect = data.fetchRectangles[i];
        var minY = san_nbr(rect.minY)
        var minX = san_nbr(rect.minX)
        var maxY = san_nbr(rect.maxY)
        var maxX = san_nbr(rect.maxX)

        if(!(minY < maxY && minX < maxX)) {
            return "Invalid range"
        }
        if(!((maxY - minY) * (maxX - minX) <= 400)) {
            return "Too many tiles"
        }
        var YTileRange = xrange(minY, maxY + 1);
        var XTileRange = xrange(minX, maxX + 1);
        for (var ty in YTileRange) { // fill in null values
            for (var tx in XTileRange) {
                tiles[YTileRange[ty] + "," + XTileRange[tx]] = null
            }
        }
        if(timemachine.active) {
            var dr1 = await db.get("select time from edit where world_id=? limit 1",
                world.id);
            var dr2 = await db.get("select time from edit where world_id=? order by id desc limit 1",
                world.id);
            if(!dr1 || !dr2) {
                // diagonal text...
                var e_str = "Cannot view timemachine: There are no edits yet. | ";
                for (var ty in YTileRange) { // fill in null values
                    for (var tx in XTileRange) {
                        var str = "";
                        for(var y = 0; y < 8; y++) {
                            for(var x = 0; x < 16; x++) {
                                var posX = XTileRange[tx]*16 + x;
                                var posY = YTileRange[ty]*8 + y;
                                var ind = posX + posY;
                                var len = e_str.length;
                                var charPos = ind - Math.floor(ind / len) * len
                                str += e_str.charAt(charPos);
                            }
                        }
                        tiles[YTileRange[ty] + "," + XTileRange[tx]] = {
                            content: str,
                            properties: {
                                writability: 2
                            }
                        };
                    }
                }
                return tiles;
            }

            dr1 = dr1.time;
            dr2 = dr2.time;

            var time = timemachine.time;
            if(!time) {
                time = Date.now();
            } else {
                var range = dr2 - dr1;
                var div = range / 1000000;
                time = Math.floor(div * timemachine.time) + dr1
            }

            await db.each("SELECT * FROM edit WHERE world_id=? AND time<=? AND tileY >= ? AND tileX >= ? AND tileY <= ? AND tileX <= ?",
                [world.id, time, minY, minX, maxY, maxX], function(data) {
                var con = JSON.parse(data.content);
                for(var i in con) {
                    var z = con[i]
                    if(!tiles[z[0] + "," + z[1]]) {
                        tiles[z[0] + "," + z[1]] = {
                            content: " ".repeat(128).split(""),
                            properties: {
                                writability: 2
                            }
                        };
                    };
                    tiles[z[0] + "," + z[1]].content[z[2]*16+z[3]] = z[5]
                }
            })

            for(var i in tiles) {
                if(tiles[i]) {
                    tiles[i].content = tiles[i].content.join("");
                }
            }
        } else {
            await db.each("SELECT * FROM tile WHERE world_id=? AND tileY >= ? AND tileX >= ? AND tileY <= ? AND tileX <= ?", 
                [world.id, minY, minX, maxY, maxX], function(data) {
                tiles[data.tileY + "," + data.tileX] = {
                    content: data.content,
                    properties: Object.assign(JSON.parse(data.properties), {
                        writability: data.writability
                    })
                }
            })
        }
    }

    return tiles;
}