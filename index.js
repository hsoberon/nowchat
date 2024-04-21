const cors    = require("cors");
const express = require("express");
const app     = express();
const mysql   = require('mysql');
const redis   = require('redis');

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
