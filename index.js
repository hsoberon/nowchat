const cors    = require("cors");
const express = require("express");
const app     = express();
const mysql   = require('mysql');
const redis   = require('redis');
const WebSocket = require('websocket').server;

// Set up CORS
const corsOptions = {
    origin: "http://localhost:3000"
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
    host    : 'localhost',
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
app.get('/', (req, res) => {
    res.send('<h1 style="text-align: center;">Welcome to the Now Chat api!</h1>');
});

// Start server
const port = 5000;

// Listen on port
app.listen(port, () => {
    console.log(`Running at - http://localhost:${port}`);
});

//Websocket
const webSocketServer = new WebSocket({
    httpServer: server,
});

webSocketServer.on('request', (request) => {
    const connection = request.accept(null, request.origin);

    connection.on('message', (message) => {
        // Handle incoming WebSocket messages here
    });

    connection.on('close', (reasonCode, description) => {
        // Handle WebSocket connection closure here
    });
});

server.listen(3001, () => {
    console.log('WebSocket server is listening on port 3001');
});

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



// >>>>>>>>>>> MESSAGES 

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