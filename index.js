const cors                  = require("cors");
const express               = require("express");
const app                   = express();
const http                  = require('http');
const url                   = require("url")
const { WebSocketServer }   = require("ws")
const mysql                 = require('mysql');
const redis                 = require('redis');
const uuidv4                = require("uuid").v4

// Set up CORS
const corsOptions = {
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"]
};
app.use(cors(corsOptions));

// Set json for getting data from request body
app.use(express.json());

// Redis setup
let redisClient;
(async () => {
    redisClient = redis.createClient();
    redisClient.on("error", (error) => console.error(`Error : ${error}`));
    redisClient.on("connect", () => console.log("Redis connected"));
    await redisClient.connect();
})();

// MySQL setup
const DB = mysql.createConnection({
    host    : '127.0.0.1',
    user    : 'root',
    password: 'root',
    database: 'now_chat',
});

// Connect to MySQL
DB.connect((err) => {
    if (err) throw err;
    console.log('MySQL connected');
});

// Routes
// app.get('/', (req, res) => {
//     res.send('<h1 style="text-align: center;">Welcome to the Now Chat api!</h1>');
// });

// Start server
const port = 5000;


//WebSocket Server
const wsServer = new WebSocketServer({ port: 8080 });

const connections = [];
var connId = '';


wsServer.on("connection", (connection, request) => {
    
    const { userFrom, userTo }  = url.parse(request.url, true).query

    if(userFrom && userTo){
        connId = (userFrom > userTo) ? userFrom + '_' + userTo : userTo + '_' + userFrom;
        const uuid = uuidv4();
        connections[uuid] = {
            conn : connection,
            channel : connId
        };
        console.log("WS Connected to channel" + connId + ' - ' + uuid);
        console.log("Connections: " + connections.length);
    }else{
        console.log("WS Connected");
    }
    // getUsers().then(msg => {
    //     console.log("Sending All Users");
    //     connection.send(JSON.stringify(msg));
    // });

    connection.on("message", (msg) => {
        const {type, message} = JSON.parse(msg);

        if(type == 'GET'){
            if(message == 'Users'){
                getUsers().then(msg => {
                        console.log("Sending All Users");
                        connection.send(JSON.stringify(msg));
                    });
            }

            if(message == "Chat" && userFrom && userTo){
                getChat(userFrom, userTo).then(msg => {
                    console.log("Sending Message History " + userFrom + ' - ' + userTo);
                    connection.send(JSON.stringify(msg));
                });    
            }
        }

        if(type == 'SEND Message'){
            const {userFrom, userTo} = JSON.parse(msg);
            newMessage(userFrom, userTo, message).then(text => {
                getChat(userFrom, userTo).then(response => {
                    Object.keys(connections).forEach(key => {
                        if(connections[key].channel == connId){
                            const JMsg = JSON.stringify(response);
                            connection = connections[key].conn;
                            connection.send(JMsg);
                            console.log("Sending Message History to " + connId + ' - ' + key);    
                        }
                    });      
                });   
            });
        }
        
    });
    
    connection.on("close", () => {
        if(userFrom && userTo){
            const connId = (userFrom > userTo) ? userFrom + '_' + userTo : userTo + '_' + userFrom;
            delete connections[connId];
            console.log("WS Closing " + connId);
        }else{
            console.log("WS Closing");
        }
    });
  })

// Listen on port
app.listen(port, () => {
    console.log(`Running at - http://127.0.0.1:${port}`);
});




// >>>>>>>>>>> WEBSOCKET 

async function getUsers(){

    const redisName =  'Users';

    try {
        // Check if cached data exists in Redis or not. If yes, return cached data
        const cachedData = await redisClient.get(redisName);
        if (cachedData) {
            return {
                success: true,
                type: 'Users',
                message: 'Users retrieved from cache!',
                data   : JSON.parse(cachedData)
            };
        }

        // If cached data doesn't exist, fetch data from database and cache it
        const results = await new Promise((resolve, reject) => {
            DB.query('SELECT * FROM Users', (err, results) => {
                if (err) reject(err);
                resolve(results);
            });
        });

        // If no data found in database, return error message
        if (!results.length) {
            return {
                success: false,
                message: 'No Users found!',
                data   : results
            };
        }

        // Cache data in Redis for 1 hour (3600 seconds)
        redisClient.setEx(redisName, 3600, JSON.stringify(results));

        // Return response
        return ({
            success: true,
            type: 'Users',
            message: 'Users retrieved from database successfully!',
            data   : results
        });
    } catch (error) { // Catch any error
        throw error;
    }
}

async function getChat(from_id, to_id){

    const redis_Ids = (from_id > to_id) ? from_id + '_' + to_id : to_id + '_' + from_id;
    const redisName =  'Chat_' + redis_Ids;

    try {
        // Check if cached data exists in Redis or not. If yes, return cached data
        const cachedData = await redisClient.get(redisName);
        if (cachedData) {
            return {
                success: true,
                type: 'Chat',
                message: 'Chat retrieved from Cache!',
                data   : JSON.parse(cachedData)
            };
        }

        // If cached data doesn't exist, fetch data from database and cache it
        const results = await new Promise((resolve, reject) => {
            DB.query('SELECT * FROM `Messages` WHERE (from_id = ? and to_id = ?) OR (from_id = ? and to_id = ?) ORDER BY created', [from_id, to_id, to_id, from_id], (err, results) => {
                if (err) reject(err);
                resolve(results);
            });
        });

        // If no data found in database, return error message
        // if (!results.length) {
        //     return {
        //         success: true,
        //         type: 'Chat'
        //         message: 'Empty Chat',
        //         data   : results
        //     };
        // }

        // Cache data in Redis for 1 hour (3600 seconds)
        redisClient.setEx(redisName, 3600, JSON.stringify(results));

        // Return response
        return ({
            success: true,
            type: 'Chat',
            message: 'Chat retrieved from database successfully!',
            data   : results
        });
    } catch (error) { // Catch any error
        throw error;
    }
}


async function newMessage(from_id, to_id, text){
    //Set the time of the message to now
    const itsNow = new Date();
    
    // Insert Message into database
    const results = await new Promise((resolve, reject) => {
        DB.query('INSERT INTO Messages (from_id, to_id, message, created) VALUES (?, ?, ?, ?)', [from_id, to_id, text, itsNow], (err, results) => {
            if (err) reject(err);
            resolve(results);
        });
    });
    
    // If no rows affected, then Message not inserted
    if (!results.affectedRows) {
        return ({
            success: false,
            message: 'Message not recived!',
            data   : results
        });
    }

    // Delete cached data from bout Redis calls
    const redis_Ids = (from_id > to_id) ? from_id + '_' + to_id : to_id + '_' + from_id;
    const redisName =  'Chat_' + redis_Ids;
    redisClient.del(redisName);

    // Return response
    return ({
        success: true,
        type: 'Chat Update',
        message: 'Message recived!'
    });
}



// >>>>>>>>>>> HTTP 

// Fetching data from Database or Redis
app.get('/users', async (req, res) => {
    try {
        // Check if cached data exists in Redis or not. If yes, return cached data
        const cachedData = await redisClient.get('Users');
        if (cachedData) {
            return res.send({
                success: true,
                message: 'Users retrieved from cache successfully!',
                data   : JSON.parse(cachedData)
            });
        }

        // If cached data doesn't exist, fetch data from database and cache it
        const results = await new Promise((resolve, reject) => {
            DB.query('SELECT * FROM Users', (err, results) => {
                if (err) reject(err);
                resolve(results);
            });
        });

        // If no data found in database, return error message
        if (!results.length) {
            return res.send({
                success: false,
                message: 'No Users found!',
                data   : results
            });
        }

        // Cache data in Redis for 1 hour (3600 seconds)
        redisClient.setEx('Users', 3600, JSON.stringify(results));

        // Return response
        return res.send({
            success: true,
            message: 'Users retrieved from database successfully!',
            data   : results
        });
    } catch (error) { // Catch any error
        throw error;
    }
});


// Create new todo/ Add todo
app.post('/users', (req, res) => {
    // Get data from request body
    const {username, name, email} = req.body;

    // Insert User into database
    DB.query('INSERT INTO Users (username, name, email) VALUES (?, ?, ?)', [username, name, email], (err, results) => {
        if (err) throw err; // Throw error if any

        // If no rows affected, then User not inserted
        if (!results.affectedRows) {
            return res.send({
                success: false,
                message: 'User not added!',
                data   : results
            });
        }

        // Delete cached data from Redis
        redisClient.del('Users');

        // Return response
        return res.send({
            success: true,
            message: 'User added successfully!',
            data   : {
                id: results.insertId,
                username,
                name,
                email
            }
        });
    });
});

// Update User
app.put('/users/:id', (req, res) => {
    // Get data from request body
    const {username, name, email} = req.body;

    // Update user in database
    DB.query('UPDATE Users SET username = ?, name = ?, email = ? WHERE id = ?', [username, name, email, req.params.id], (err, results) => {
        if (err) throw err; // Throw error if any

        // If no rows affected, then User not updated
        if (!results.affectedRows) {
            return res.send({
                success: false,
                message: 'User not updated!',
                data   : results
            });
        }

        // Delete cached data from Redis
        redisClient.del('Users');

        // Return response
        return res.send({
            success: true,
            message: 'User updated successfully!',
            data   : {
                id: req.params.id,
                username, 
                name, 
                email
            }
        });
    });
});

// Delete User
app.delete('/users/:id', (req, res) => {
    DB.query('DELETE FROM Users WHERE id = ?', [req.params.id], (err, results) => {
        if (err) throw err; // Throw error if any

        // If no rows affected, then user not deleted
        if (!results.affectedRows) {
            return res.send({
                success: false,
                message: 'User not deleted!',
                data   : results
            });
        }

        // Delete cached data from Redis
        redisClient.del('Users');

        // Return response
        return res.send({
            success: true,
            message: 'User deleted successfully!'
        });
    });
});




// Fetching data from Database or Redis
app.get('/messages/:firstUserId/:secondUserId', async (req, res) => {

    const {firstUserId, secondUserId} = req.params;

    const redisName = 'Messages_' + firstUserId + '_' + secondUserId;

    try {
        // Check if cached data exists in Redis or not. If yes, return cached data
        const cachedData = await redisClient.get(redisName);
        if (cachedData) {
            return res.send({
                success: true,
                message: 'Messages retrieved from cache successfully!',
                data   : JSON.parse(cachedData)
            });
        }

        // If cached data doesn't exist, fetch data from database and cache it
        const results = await new Promise((resolve, reject) => {
            DB.query('SELECT * FROM `Messages` WHERE (from_id = ? and to_id = ?) OR (from_id = ? and to_id = ?) ORDER BY created', [firstUserId, secondUserId, secondUserId, firstUserId], (err, results) => {
                if (err) reject(err);
                resolve(results);
            });
        });

        // If no data found in database, return error message
        if (!results.length) {
            return res.send({
                success: false,
                message: 'No Messages found!',
                data   : results
            });
        }

        // Cache data in Redis for 1 hour (3600 seconds)
        redisClient.setEx(redisName, 3600, JSON.stringify(results));

        // Return response
        return res.send({
            success: true,
            message: 'Messages retrieved from database successfully!',
            data   : results
        });
    } catch (error) { // Catch any error
        throw error;
    }
});


// Recieves a new message
app.post('/messages', (req, res) => {
    // Get data from request body
    const {from_id, to_id, text} = req.body;

    // Insert Message into database
    DB.query('INSERT INTO Messages (from_id, to_id, message, created) VALUES (?, ?, ?, NOW())', [from_id, to_id, text], (err, results) => {
        if (err) throw err; // Throw error if any

        // If no rows affected, then Message not inserted
        if (!results.affectedRows) {
            return res.send({
                success: false,
                message: 'Message not recived!',
                data   : results
            });
        }

        // Delete cached data from bout Redis calls
        redisClient.del('Messages_' + from_id + '_' + to_id);
        redisClient.del('Messages_' + to_id + '_' + from_id);

        // Return response
        return res.send({
            success: true,
            message: 'Message recived!',
            data   : {
                id: results.insertId,
                from_id,
                to_id,
                text,
            }
        });
    });
});