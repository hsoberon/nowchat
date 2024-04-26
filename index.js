const express = require("express")
const http = require("http")
const uuidv4                = require("uuid").v4
require('dotenv').config();
const mysql                 = require('mysql');
const redis                 = require('redis');
const app = express()
const server = http.createServer(app)
const io = require("socket.io")(server, {
	cors: {
		origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
		methods: [ "GET", "POST" ]
	}
})

const PORT = process.env.PORT ;

let users = {};

let socketToRoom = {};

const maximum = 2;

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
  host    : process.env.DB_URL,
  user    : process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_DATABASE,
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


//Chat connections
const connections = [];


io.on("connection", (socket) => {
  console.log("Connected from: " + socket.id);

  const uuid = uuidv4();
  


  //USERS
  socket.on("users", (data) => {
    getUsers().then(msg => {
      console.log("Sending All Users");
      socket.broadcast.emit("allusers", msg);
    });
  });

  socket.on("createUser", ({username, name, email}) => {    
    createUser(username, name, email).then(msg => {
      console.log("New User Created");
      socket.emit("newUser", msg);
    });
  });

  socket.on("updateUser", ({userId, username, name, email}) => {    
    updateUser(userId, username, name, email).then(msg => {
      console.log("Updated User " + userId);
      socket.emit("editedUser", msg);
    });
  });

  socket.on("deleteUser", ({userId}) => {    
    deleteUser(userId).then(msg => {
      console.log("Deleted User " + userId);
      socket.emit("deletedUser", msg);
    });
  });




  //CHATS
  socket.on("chat", ({userFrom, userTo}) => {

    const connId = (userFrom > userTo) ? 'Chat_' + userFrom + '_' + userTo : 'Chat_' + userTo + '_' + userFrom;
    connections[uuid] = {
      conn : socket,
      channel :  connId
    };

    getChat(userFrom, userTo).then(msg => {
      Object.keys(connections).forEach(key => {
        if(connections[key].channel == connId){
            const thisSocket = connections[key].conn;
            console.log("Sending All Messages from " + userFrom + ' to ' + userTo);
            // socket.to(socketId).emit("messages", msg);
            thisSocket.emit("messages", msg);
        }
      });
      
    });
  });

  socket.on("sendMessage", ({userFrom, userTo, text}) => {
    newMessage(userFrom, userTo, text).then(msg => {
      console.log("Sending New Messages from " + userFrom + ' to ' + userTo);
      socket.emit("newMessages", msg);
    });
  });





  //VIDEO CALLS 
  socket.emit("me", socket.id);

  socket.on("join_room", (data) => {
    if (users[data.room]) {
      const length = users[data.room].length;
      if (length === maximum) {
        socket.to(socket.id).emit("room_full");
        return;
      }
      users[data.room].push({ id: socket.id });
    } else {
      users[data.room] = [{ id: socket.id }];
    }
    socketToRoom[socket.id] = data.room;

    socket.join(data.room);
    console.log(`[${socketToRoom[socket.id]}]: ${socket.id} enter`);

    const usersInThisRoom = users[data.room].filter(
      (user) => user.id !== socket.id
    );

    console.log(usersInThisRoom);

    io.sockets.to(socket.id).emit("all_users", usersInThisRoom);
  });

  socket.on("offer", (sdp) => {
    console.log("offer: " + socket.id);
    socket.broadcast.emit("getOffer", sdp);
  });

  socket.on("answer", (sdp) => {
    console.log("answer: " + socket.id);
    socket.broadcast.emit("getAnswer", sdp);
  });

  socket.on("candidate", (candidate) => {
    console.log("candidate: " + socket.id);
    socket.broadcast.emit("getCandidate", candidate);
  });

  socket.on("disconnect", () => {
    console.log(`[${socketToRoom[socket.id]}]: ${socket.id} exit`);
    const roomID = socketToRoom[socket.id];
    let room = users[roomID];
    if (room) {
      room = room.filter((user) => user.id !== socket.id);
      users[roomID] = room;
      if (room.length === 0) {
        delete users[roomID];
        return;
      }
    }
    socket.broadcast.to(room).emit("user_exit", { id: socket.id });
    console.log(users);
  });
});

server.listen(PORT, () => {
  console.log(`server running on ${PORT}`);
});



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


// Create new todo/ Add todo
async function createUser(username, name, email) {

  // Insert User into database
  const results = await new Promise((resolve, reject) => {
    DB.query('INSERT INTO Users (username, name, email) VALUES (?, ?, ?)', [username, name, email], (err, results) => {
      if (err) reject(err);
      resolve(results);
    })
  });
      

  // If no rows affected, then User not inserted
  if (!results.affectedRows) {
      return ({
          success: false,
          message: 'User not added!',
          data   : results
      });
  }
  

  // Delete cached data from Redis
  redisClient.del('Users');

  // Return response
  return ({
      success: true,
      message: 'User added successfully!',
      data   : {
        id: results.insertId,
        username,
        name,
        email, 
      }
  })
  
}

// Update User
async function updateUser(userId, username, name, email) {

  // Update user in database
  const results = await new Promise((resolve, reject) => {
    DB.query('UPDATE Users SET username = ?, name = ?, email = ? WHERE id = ?', [username, name, email, userId], (err, results) => {
      if (err) reject(err);
      resolve(results);
    })
  });

  // If no rows affected, then User not updated
  if (!results.affectedRows) {
    return ({
        success: false,
        message: 'User not updated!',
        data   : results
    });
  }

  // Delete cached data from Redis
  redisClient.del('Users');

  // Return response
  return ({
      success: true,
      message: 'User updated successfully!',
      data   : {
        id: userId,
        username,
        name,
        email, 
      }
  })

}




// Delete User
async function deleteUser(userId){

  const results = await new Promise((resolve, reject) => {
    DB.query('DELETE FROM Users WHERE id = ?', [userId], (err, results) => {
      if (err) reject(err);
      resolve(results);
    })
  });

  // If no rows affected, then user not deleted
  if (!results.affectedRows) {
      return ({
          success: false,
          message: 'User not deleted!',
          data   : results
      });
  }

  // Delete cached data from Redis
  redisClient.del('Users');

  // Return response
  return ({
      success: true,
      message: 'User deleted successfully!'
  });
};





// >>> MESSAGES CHAT
async function getChat(userFrom, userTo){

  const redis_Ids = (userFrom > userTo) ? userFrom + '_' + userTo : userTo + '_' + userFrom;
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
          DB.query('SELECT * FROM `Messages` WHERE (from_id = ? and to_id = ?) OR (from_id = ? and to_id = ?) ORDER BY created', [userFrom, userTo, userTo, userFrom], (err, results) => {
              if (err) reject(err);
              resolve(results);
          });
      });

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



async function newMessage(userFrom, userTo, text){
  //Set the time of the message to now
  const itsNow = new Date();
  
  // Insert Message into database
  const results = await new Promise((resolve, reject) => {
      DB.query('INSERT INTO Messages (from_id, to_id, message, created) VALUES (?, ?, ?, ?)', [userFrom, userTo, text, itsNow], (err, results) => {
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

  // Delete cached data from Redis 
  const redis_Ids = (userFrom > userTo) ? userFrom + '_' + userTo : userTo + '_' + userFrom;
  const redisName =  'Chat_' + redis_Ids;
  redisClient.del(redisName);

  // Return response
  return ({
      success: true,
      type: 'Chat Update',
      message: 'Message recived!',
      data : {
        id : results.insertId,
        from_id : userFrom,
        to_id: userTo,
        message: text,
        created: itsNow
      }
  });
}

