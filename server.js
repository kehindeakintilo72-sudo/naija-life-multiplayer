const express = require("express");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const Database = require("better-sqlite3");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const helmet = require("helmet");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true } });
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-this-secret";
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || "").toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const DB_FILE = process.env.DB_FILE || path.join(__dirname, "naija-life.sqlite");
const db = new Database(DB_FILE);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 username TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'player' CHECK(role IN ('player','admin')),
 cash INTEGER NOT NULL DEFAULT 15000 CHECK(cash >= 0),
 xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
 location TEXT NOT NULL DEFAULT 'Yaba',
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS houses (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 price INTEGER NOT NULL CHECK(price >= 0),
 location TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_houses (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 house_id INTEGER NOT NULL REFERENCES houses(id),
 purchased_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, house_id)
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 pay INTEGER NOT NULL CHECK(pay > 0),
 xp INTEGER NOT NULL DEFAULT 10
);
CREATE TABLE IF NOT EXISTS job_logs (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 job_id INTEGER NOT NULL REFERENCES jobs(id),
 earned INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS friendships (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 friend_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('pending','accepted')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(user_id, friend_id),
 CHECK(user_id != friend_id)
);
CREATE TABLE IF NOT EXISTS private_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reported_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 reason TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewed','dismissed')),
 created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS mutes (
 muter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 muted_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(muter_id, muted_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 username TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
`);
if (db.prepare("SELECT COUNT(*) AS n FROM jobs").get().n === 0) {
  const add = db.prepare("INSERT INTO jobs(name,pay,xp) VALUES(?,?,?)");
  [["Shop Assistant",3500,10],["Junior Developer",6000,18],["Market Seller",2800,8],["Delivery Rider",4200,12]].forEach(x=>add.run(...x));
}
if (db.prepare("SELECT COUNT(*) AS n FROM houses").get().n === 0) {
  const add = db.prepare("INSERT INTO houses(name,price,location) VALUES(?,?,?)");
  [["Yaba Starter Room",12000,"Yaba"],["Mainland Apartment",35000,"Surulere"],["Marina Studio",60000,"Marina"],["Lekki Duplex",180000,"Lekki"]].forEach(x=>add.run(...x));
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "30kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));
app.use(session({
  name: "naija.sid",
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 180, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public")));

const allowedLocations = new Set(["Yaba","Balogun Market","The Beach","Tech Hub","Freedom Park","Marina","Surulere","Lekki"]);
const usernamePattern = /^[a-zA-Z0-9_]{3,20}$/;
const now = () => Date.now();
const getUser = id => db.prepare("SELECT id, username, role, cash, xp, location, created_at FROM users WHERE id=?").get(id);
const safeUser = u => u && ({id:u.id, username:u.username, role:u.role, cash:u.cash, xp:u.xp, level:1+Math.floor(u.xp/100), location:u.location, created_at:u.created_at});
function requireAuth(req,res,next){const u=req.session.userId && getUser(req.session.userId);if(!u){return res.status(401).json({error:"Please log in first."});}req.user=u;next();}
function requireAdmin(req,res,next){if(!req.user || req.user.role!=="admin")return res.status(403).json({error:"Admin access required."});next();}
function cleanBody(s,max=500){return typeof s==="string"?s.replace(/[<>]/g,"").replace(/\s+/g," ").trim().slice(0,max):"";}
function fail(res,error,status=400){return res.status(status).json({error});}
function friendshipStatus(a,b){return db.prepare("SELECT status FROM friendships WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)").get(a,b,b,a);}
function areFriends(a,b){const f=friendshipStatus(a,b);return !!f && f.status==="accepted";}
function userByUsername(name){return db.prepare("SELECT id,username FROM users WHERE username=? COLLATE NOCASE").get(name);}
function onlineUsers(){return [...onlineSockets.entries()].map(([id,sockets])=>{const u=getUser(id);return u?{id:u.id,username:u.username,location:u.location,online:true}:null}).filter(Boolean);}
const onlineSockets = new Map();
const socketSession = session;
io.engine.use((req,res,next)=>socketSession(req,res,next));
io.use((socket,next)=>{const id=socket.request.session && socket.request.session.userId;const u=id && getUser(id);if(!u)return next(new Error("Please log in through the website first."));socket.user=safeUser(u);next();});
io.on("connection", socket=>{
 const uid=socket.user.id;
 if(!onlineSockets.has(uid))onlineSockets.set(uid,new Set());
 onlineSockets.get(uid).add(socket.id);
 socket.join("player:"+uid);
 socket.emit("presence:list",onlineUsers());
 io.emit("presence:list",onlineUsers());
 socket.on("world:move", location=>{
  if(!allowedLocations.has(location))return;
  db.prepare("UPDATE users SET location=? WHERE id=?").run(location,uid);
  socket.user=safeUser(getUser(uid));
  io.emit("presence:list",onlineUsers());
  socket.emit("world:moved",{location});
 });
 socket.on("world:chat", raw=>{
  const body=cleanBody(raw,240);if(!body)return;
  const muted=db.prepare("SELECT muted_id FROM mutes WHERE muter_id=?").all(uid).map(x=>x.muted_id);
  const recent=db.prepare("SELECT created_at FROM chat_messages WHERE user_id=? ORDER BY id DESC LIMIT 1").get(uid);
  if(recent && now()-recent.created_at<1000)return socket.emit("app:error","Please wait a moment before sending another message.");
  const result=db.prepare("INSERT INTO chat_messages(user_id,username,body,created_at) VALUES(?,?,?,?)").run(uid,socket.user.username,body,now());
  const message={id:Number(result.lastInsertRowid),username:socket.user.username,body,created_at:now(),user_id:uid};
  io.emit("world:chat-message",message);
  db.prepare("DELETE FROM chat_messages WHERE id NOT IN (SELECT id FROM chat_messages ORDER BY id DESC LIMIT 100)").run();
 });
 socket.on("private:send", data=>{
  const targetId=Number(data && data.to);const body=cleanBody(data && data.body,500);
  if(!Number.isInteger(targetId)||targetId===uid||!body||!areFriends(uid,targetId))return socket.emit("app:error","Private messages are only available between accepted friends.");
  const result=db.prepare("INSERT INTO private_messages(sender_id,receiver_id,body,created_at) VALUES(?,?,?,?)").run(uid,targetId,body,now());
  const msg={id:Number(result.lastInsertRowid),sender_id:uid,receiver_id:targetId,body,created_at:now()};
  io.to("player:"+uid).to("player:"+targetId).emit("private:message",msg);
 });
 socket.on("disconnect",()=>{
  const set=onlineSockets.get(uid);if(set){set.delete(socket.id);if(!set.size)onlineSockets.delete(uid);}
  io.emit("presence:list",onlineUsers());
 });
});

app.get("/api/health",(_req,res)=>res.json({ok:true,app:"Naija Life"}));
app.post("/api/register",async(req,res)=>{
 const username=cleanBody(req.body.username,20), password=typeof req.body.password==="string"?req.body.password:"";
 if(!usernamePattern.test(username))return fail(res,"Username must be 3–20 characters using letters, numbers or underscores.");
 if(password.length<10||password.length>128)return fail(res,"Password must be at least 10 characters (maximum 128).");
 if(userByUsername(username))return fail(res,"That username is already taken.",409);
 try{
  const hash=await bcrypt.hash(password,12);
  const role=(ADMIN_USERNAME && ADMIN_PASSWORD && username.toLowerCase()===ADMIN_USERNAME && password===ADMIN_PASSWORD)?"admin":"player";
  const result=db.prepare("INSERT INTO users(username,password_hash,role,created_at) VALUES(?,?,?,?)").run(username,hash,role,now());
  req.session.userId=Number(result.lastInsertRowid);
  req.session.save(err=>{if(err)return fail(res,"Could not create session.",500);res.json({user:safeUser(getUser(req.session.userId))});});
 }catch(e){return fail(res,"Registration failed. The username may already exist.",409);}
});
app.post("/api/login",async(req,res)=>{
 const username=cleanBody(req.body.username,20), password=typeof req.body.password==="string"?req.body.password:"";
 const row=db.prepare("SELECT * FROM users WHERE username=? COLLATE NOCASE").get(username);
 if(!row||!(await bcrypt.compare(password,row.password_hash)))return fail(res,"Invalid username or password.",401);
 req.session.regenerate(err=>{if(err)return fail(res,"Could not start session.",500);req.session.userId=row.id;req.session.save(err2=>{if(err2)return fail(res,"Could not save session.",500);res.json({user:safeUser(getUser(row.id))});});});
});
app.post("/api/logout",(req,res)=>req.session.destroy(()=>{res.clearCookie("naija.sid");res.json({ok:true});}));
app.get("/api/me",requireAuth,(req,res)=>res.json({user:safeUser(req.user)}));
app.post("/api/location",requireAuth,(req,res)=>{
 const location=req.body.location;
 if(!allowedLocations.has(location))return fail(res,"Unknown location.");
 db.prepare("UPDATE users SET location=? WHERE id=?").run(location,req.user.id);
 res.json({user:safeUser(getUser(req.user.id))});
});
app.get("/api/world",requireAuth,(req,res)=>{
 const jobs=db.prepare("SELECT id,name,pay,xp FROM jobs ORDER BY pay DESC").all();
 const houses=db.prepare("SELECT h.id,h.name,h.price,h.location,CASE WHEN o.user_id IS NULL THEN 0 ELSE 1 END AS owned FROM houses h LEFT JOIN owned_houses o ON o.house_id=h.id AND o.user_id=? ORDER BY h.price").all(req.user.id);
 const feed=db.prepare("SELECT username,body,created_at FROM chat_messages ORDER BY id DESC LIMIT 30").all().reverse();
 const myHouses=db.prepare("SELECT h.id,h.name,h.price,h.location,o.purchased_at FROM owned_houses o JOIN houses h ON h.id=o.house_id WHERE o.user_id=?").all(req.user.id);
 res.json({user:safeUser(req.user),jobs,houses,myHouses,online:onlineUsers(),feed});
});
app.post("/api/jobs/:id/work",requireAuth,(req,res)=>{
 const job=db.prepare("SELECT * FROM jobs WHERE id=?").get(Number(req.params.id));if(!job)return fail(res,"Job not found.",404);
 const recent=db.prepare("SELECT created_at FROM job_logs WHERE user_id=? ORDER BY id DESC LIMIT 1").get(req.user.id);
 if(recent&&now()-recent.created_at<30000)return fail(res,"Rest for a moment before taking another shift.");
 const tx=db.transaction(()=>{db.prepare("UPDATE users SET cash=cash+?,xp=xp+? WHERE id=?").run(job.pay,job.xp,req.user.id);db.prepare("INSERT INTO job_logs(user_id,job_id,earned,created_at) VALUES(?,?,?,?)").run(req.user.id,job.id,job.pay,now());});
 tx();res.json({user:safeUser(getUser(req.user.id)),message:`Shift complete: earned ₦${job.pay.toLocaleString("en-NG")}.`});
});
app.post("/api/houses/:id/buy",requireAuth,(req,res)=>{
 const house=db.prepare("SELECT * FROM houses WHERE id=?").get(Number(req.params.id));if(!house)return fail(res,"House not found.",404);
 if(db.prepare("SELECT 1 FROM owned_houses WHERE user_id=? AND house_id=?").get(req.user.id,house.id))return fail(res,"You already own this property.");
 if(req.user.cash<house.price)return fail(res,"Not enough money yet. Work a few shifts first.");
 const tx=db.transaction(()=>{db.prepare("UPDATE users SET cash=cash-? WHERE id=?").run(house.price,req.user.id);db.prepare("INSERT INTO owned_houses(user_id,house_id,purchased_at) VALUES(?,?,?)").run(req.user.id,house.id,now());});
 try{tx();res.json({user:safeUser(getUser(req.user.id)),message:`You bought ${house.name}!`});}catch(e){return fail(res,"Could not buy this property.");}
});
app.get("/api/friends",requireAuth,(req,res)=>{
 const friends=db.prepare(`SELECT u.id,u.username,f.status,f.user_id AS requester_id FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_id=? THEN f.friend_id ELSE f.user_id END WHERE f.user_id=? OR f.friend_id=? ORDER BY f.created_at DESC`).all(req.user.id,req.user.id,req.user.id);
 res.json({friends});
});
app.post("/api/friends/request",requireAuth,(req,res)=>{
 const target=userByUsername(cleanBody(req.body.username,20));if(!target)return fail(res,"Player not found.",404);if(target.id===req.user.id)return fail(res,"You cannot add yourself.");
 const existing=friendshipStatus(req.user.id,target.id);if(existing)return fail(res,existing.status==="accepted"?"You are already friends.":"A friend request already exists.");
 db.prepare("INSERT INTO friendships(user_id,friend_id,status,created_at) VALUES(?,?,'pending',?)").run(req.user.id,target.id,now());
 io.to("player:"+target.id).emit("friends:update");res.json({ok:true,message:"Friend request sent."});
});
app.post("/api/friends/:id/accept",requireAuth,(req,res)=>{
 const other=Number(req.params.id);const row=db.prepare("SELECT * FROM friendships WHERE user_id=? AND friend_id=? AND status='pending'").get(other,req.user.id);
 if(!row)return fail(res,"No incoming friend request found.",404);
 db.prepare("UPDATE friendships SET status='accepted' WHERE user_id=? AND friend_id=?").run(other,req.user.id);
 db.prepare("INSERT OR IGNORE INTO friendships(user_id,friend_id,status,created_at) VALUES(?,?,'accepted',?)").run(req.user.id,other,now());
 io.to("player:"+other).emit("friends:update");res.json({ok:true});
});
app.get("/api/messages/:id",requireAuth,(req,res)=>{
 const other=Number(req.params.id);if(!areFriends(req.user.id,other))return fail(res,"You can only message accepted friends.",403);
 const rows=db.prepare("SELECT id,sender_id,receiver_id,body,created_at FROM private_messages WHERE (sender_id=? AND receiver_id=?) OR (sender_id=? AND receiver_id=?) ORDER BY id DESC LIMIT 100").all(req.user.id,other,other,req.user.id).reverse();
 res.json({messages:rows});
});
app.post("/api/report",requireAuth,(req,res)=>{
 const target=Number(req.body.userId),reason=cleanBody(req.body.reason,300);if(!Number.isInteger(target)||target===req.user.id||!getUser(target))return fail(res,"Choose a valid player to report.");
 if(reason.length<5)return fail(res,"Please give a short reason (at least 5 characters).");
 db.prepare("INSERT INTO reports(reporter_id,reported_id,reason,created_at) VALUES(?,?,?,?)").run(req.user.id,target,reason,now());res.json({ok:true,message:"Report submitted for review."});
});
app.post("/api/mute/:id",requireAuth,(req,res)=>{
 const target=Number(req.params.id);if(!getUser(target)||target===req.user.id)return fail(res,"Choose a valid player.");
 db.prepare("INSERT OR IGNORE INTO mutes(muter_id,muted_id,created_at) VALUES(?,?,?)").run(req.user.id,target,now());res.json({ok:true,message:"Player muted for you."});
});
app.get("/api/admin/reports",requireAuth,requireAdmin,(req,res)=>{
 const reports=db.prepare(`SELECT r.id,r.reported_id,r.reason,r.status,r.created_at,reporter.username AS reporter,reported.username AS reported FROM reports r JOIN users reporter ON reporter.id=r.reporter_id JOIN users reported ON reported.id=r.reported_id ORDER BY r.id DESC LIMIT 200`).all();res.json({reports});
});
app.post("/api/admin/reports/:id/status",requireAuth,requireAdmin,(req,res)=>{
 const status=req.body.status;if(!["reviewed","dismissed","open"].includes(status))return fail(res,"Invalid report status.");
 const result=db.prepare("UPDATE reports SET status=? WHERE id=?").run(status,Number(req.params.id));if(!result.changes)return fail(res,"Report not found.",404);res.json({ok:true});
});
app.post("/api/admin/users/:id/ban",requireAuth,requireAdmin,(req,res)=>{
 const id=Number(req.params.id);if(id===req.user.id)return fail(res,"You cannot ban yourself.");
 const target=getUser(id);if(!target)return fail(res,"Player not found.",404);
 db.prepare("DELETE FROM users WHERE id=?").run(id);
 for(const sid of onlineSockets.get(id)||[])io.to(sid).emit("account:removed");
 for(const sid of onlineSockets.get(id)||[])io.sockets.sockets.get(sid)?.disconnect(true);
 res.json({ok:true,message:`Deleted player ${target.username}. This is a permanent demo ban/delete.`});
});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"public","index.html")));
server.listen(PORT,"0.0.0.0",()=>console.log(`Naija Life v2 listening on port ${PORT}`));
