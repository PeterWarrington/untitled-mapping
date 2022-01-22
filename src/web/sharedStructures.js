shared = {};

// If running on backend, make accessible
try {
    module.exports.shared = shared;
} catch {}

// Readable debug_on setting across both client and server
shared.debug_on = true;

/** A database model used to containerise map data using an ID system
 * of the format [Type]_[UID]
 * Contained map objects are accessed using database.db[id],
 * map objects are added using database.addMapObject(mapObject).
 */
shared.MapDataObjectDB = class MapDataObjectDB {
    /** Object, where key is the ID of the MapObject */
    db = {}
    /** Caches point IDs */
    pointIDs = []
    /** Caches path IDs */
    pathIDs = []
    /** Caches part IDs */
    partIDs = []

    /**
     * Adds a map object to the database, generating a random ID.
     * @param {MapDataObject} mapObject Map object to add
     */
    addMapObject(mapObject) {
        let ID = "";

        if (mapObject.ID != null) {
            ID = mapObject.ID;
        } else {
            if (mapObject instanceof shared.MapPoint)
                ID += "POINT";
            else if (mapObject instanceof shared.PathPart)
                ID += "PART";
            else if (mapObject instanceof shared.Path)
                ID += "PATH";
            else
                ID += "GENERIC";

            ID += "_";

            // Generate random characters for ID https://stackoverflow.com/a/1349426
            var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
            var charactersLength = characters.length;
            for ( var i = 0; i < 6; i++ ) {
                ID += characters.charAt(Math.floor(Math.random() * charactersLength));
            }
        }

        // Add to DB
        mapObject.ID = ID;
        this.db[ID] = mapObject;

        // Cache ID
        if (ID.indexOf("POINT") == 0) this.pointIDs.push(ID);
        if (ID.indexOf("PART") == 0) this.partIDs.push(ID);
        if (ID.indexOf("PATH") == 0) this.pathIDs.push(ID);

        return mapObject;
    }

    getMapObjectsOfType(type) {
        let mapObjects = [];
        let objectIDs = this.getMapObjectIDsOfType(type);
        objectIDs.forEach((objectID) => mapObjects.push(this.db[objectID]));

        return mapObjects;
    }

    getMapObjectIDsOfType(type) {
        return Object.keys(this.db).filter(id => id.indexOf(type) == 0);
    }

    /**
     * Converts a un-instanciated object into a database.
     * @param {*} object Un-instanciated object detailing a database
     * @returns {MapDataObjectDB}
     */
    static MapDataObjectDBFromObject(object) {
        var database = new shared.MapDataObjectDB();

        var db = object.db;
        var pointIDs = Object.keys(db).filter(id => id.indexOf("POINT") == 0);
        var pathPartIDs = Object.keys(db).filter(id => id.indexOf("PART") == 0);
        var pathIDs = Object.keys(db).filter(id => id.indexOf("PATH") == 0);

        pointIDs.forEach(pointID => {
            let point = shared.MapPoint.mapPointFromObject(db[pointID]);
            point.options = new shared.MapPoint().options; // Strip options, replace with default
            database.addMapObject(point);
        });

        pathPartIDs.forEach(pathPartID => {
            let pathPart = shared.PathPart.pathPartFromObject(db[pathPartID]);
            database.addMapObject(pathPart);
        });

        pathIDs.forEach(pathID => {
            let path = shared.Path.pathFromObject(db[pathID]);
            database.addMapObject(path);
        });

        return database;
    }

    /**
     * Copy another database's items into this db.
     * @param {MapDataObjectDB} otherDB 
     */
    mergeWithOtherDB(otherDB) {
        let otherDBitems = Object.values(otherDB.db);

        for (let i = 0; i < otherDBitems.length; i++) {
            const item = otherDBitems[i];

            if (this.db[item.ID] == undefined)
                this.addMapObject(item);
        }
    }
}

shared.MapDataObject = class MapDataObject {
    /** String for the ID of the data object */
    ID = null;
    /** Additional metadata, e.g. place name */
    metadata = {}
}

shared.MapPoint = class MapPoint extends shared.MapDataObject {
    /** Fixed x position of point in relation to others */
    x
    /** Fixed y position of point in relation to others */
    y

    /** Options for the point when drawing to screen */
    options = {
        pointDrawMethod: "none",
        pointText: "•",
        pointFont: "sans-serif",
        pointFontWidth: 16,
        pointFillStyle: "#878787",
        pathDrawPointX: 3,
        pathDrawPointY: -6
    }

    /**
     * Creates a point that can form part of a path and be displayed on a canvas.
     * @param {int} x Fixed x position of point in relation to others
     * @param {int} y Fixed y position of point in relation to others
     * @param {object} options Options for the point when drawing to screen
     * @param {object} metadata Optional metadata such as name
     */
    constructor (x, y, options={}, metadata={}) {
        super();

        this.x = x;
        this.y = y;

        this.metadata = metadata;

        this.options = {...this.options, ...options};
    }

    /**
     * Converts a simple object representing a MapPoint (such as that returned from an API)
     * to a MapPoint.
     * @param {Object} object the MapPoint represented as a simple object to convert
     * @returns MapPoint
     */
    static mapPointFromObject(object) {
        var mapPoint = new shared.MapPoint(object.x, object.y, object.options, object.metadata);
        mapPoint.ID = object.ID;
        mapPoint.metadata = object.metadata;

        return mapPoint;
    }
}

/**
 * Defines a "edge" between two nodes
 */
shared.PathPart = class PathPart extends shared.MapDataObject {
    /** The id of the {Point} referenced by this path part */
    pointID
    /** The IDs of the path parts this connects to */
    nextPathPartIDs = []

    /**
     * @param {string} pointID The ID of the point referenced by this path part
     * @param {string[]} nextPathPartIDs Array of next part IDs in the path
     */
    constructor (pointID=null, nextPathPartIDs=[], metadata={}) {
        super();
        
        this.pointID = pointID;
        this.nextPathPartIDs = nextPathPartIDs;
        this.metadata = metadata
    }

    /**
     * Converts a simple object representing a PathPart (such as that returned from an API)
     * to a PathPart.
     * @param {Object} object the path part represented as a simple object to convert
     * @returns PathPart
     */
    static pathPartFromObject (object) {
        var pathPart = new shared.PathPart(object.pointID, object.nextPathPartIDs, object.metadata);
        pathPart.ID = object.ID;
        pathPart.metadata = object.metadata;
        return pathPart;
    }

    static getPartByStepsAway(database, pathPart, steps) {
        // Base case 
        if (steps == 0 || pathPart.nextPathPartIDs.length == 0)
            return pathPart;
        else {
            var nextPathPart = database.db[pathPart.nextPathPartIDs[0]];
            return this.getPartByStepsAway(database, nextPathPart, steps-1);
        }
    }

    connectingTo(IDofPointConnectingTo, database) {
        var connectingPathPart = new PathPart(IDofPointConnectingTo);
        var pathPart = database.addMapObject(IDofPointConnectingTo);
        this.nextPathPartIDs.push(pathPart.ID);

        return pathPart;
    }
}

shared.Path = class Path extends shared.MapDataObject {
    /** The {PathPart} object ID that begins the path */
    startingPathPartID
    /** Data, including options for the path when drawing to screen */
    data = {
        pathFillStyle: "#e8cc4a",
        pathLineWidth: 4
    }

    /** Returns the line width to be displayed on the canvas */
    get lineWidth() {
        return this.data.pathLineWidth;
    }

    /**
     * Creates a path using a starting points
     * @param {string} startingPathPartID The ID of {PathPart} object that begins the path
     * @param {object} data Data, including options for the path when drawing to screen
     */
    constructor (startingPathPartID, data={}) {
        super();

        this.startingPathPartID = startingPathPartID;
        this.data = {...this.data, ...data};
    }

    /**
     * Converts a simple object representing a Path (such as that returned from an API)
     * to a Path.
     * @param {Object} object the path represented as a simple object to convert
     * @returns Path
     */
    static pathFromObject(object) {
        var path = new shared.Path(object.startingPathPartID, object.data);
        path.ID = object.ID;
        path.metadata = object.metadata;

        return path;
    }

    /**
     * Converts a tree of connecting points to a array of all points (for drawing individual points unconnectedly).
     * @returns {MapPoint[]} 
     */
    getAllPointsOnPath(database, currentPathPartID=this.startingPathPartID, pathIDArray=[]) {
        if (currentPathPart.nextPathPartIDs != null && database.db[currentPathPartID].nextPathPartIDs.length != 0) {
            for (var i=0; i < database.db[currentPathPartID].nextPathPartIDs.length; i++) {
                if (i==0)
                    pathArray.push(database.db[currentPathPartID].pointID);
                pathArray.push(database.db[database.db[currentPathPartID].nextPathPartIDs[i]].pointID);
                this.getAllPointsOnPath(database, currentPathPartID=database.db[currentPathPartID].nextPathPartIDs[i], pathIDArray);
            }
        }
        return pathArray;
    }

    copyPathContentsToDB(fromDB, toDB, currentPathPartID=this.startingPathPartID) {
        var currentPathPart = fromDB.db[currentPathPartID];

        toDB.addMapObject(currentPathPart);
        toDB.addMapObject(fromDB.db[fromDB.db[currentPathPartID].pointID]);

        if (currentPathPart.nextPathPartIDs != null && currentPathPart.nextPathPartIDs.length != 0)
            for (var i=0; i < currentPathPart.nextPathPartIDs.length; i++)
                this.copyPathContentsToDB(fromDB, toDB, currentPathPartID=currentPathPart.nextPathPartIDs[i]);
    }

    /**
     * Converts a sequential array of points to a path
     * @param {MapPoint[]} pathArray A sequential array of {MapPoint}s
     * @returns {Path} {Path} of connecting points
     */ 
    static connectSequentialPoints(pathArray, database) {
        var pathIdArray = [];
        
        for (let i = 0; i < pathArray.length; i++) {
            const point = pathArray[i];
            database.addMapObject(point);
            pathIdArray.push(point.ID);
        }

        // Set up path parts
        var startingPathPart;
        var previousPathPart;

        for (let i = 0; i < pathArray.length; i++) {
            var currentPathPart = new shared.PathPart(pathIdArray[i]);
            
            database.addMapObject(currentPathPart);

            if (i == 0)
                startingPathPart = currentPathPart;
            if (previousPathPart != undefined)
                previousPathPart.nextPathPartIDs = [currentPathPart.ID];
                
            previousPathPart = currentPathPart;
        }
        var newPath = new shared.Path(startingPathPart.ID);
        return newPath;
    }
}