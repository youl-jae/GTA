var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");
var cors = require("cors");
const moment = require("moment-timezone");
logger.token("date", (req, res, tz) => {
  return moment().tz(tz).format();
});
logger.format(
  "myformat",
  ':remote-addr - :remote-user [:date[Asia/Seoul]] ":method :url HTTP/:http-version" :status :res[content-length]',
);

var app = express();

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "jade");

app.use(logger("myformat"));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(path.join(__dirname, "front")));

app.use(cors());
app.use("/", require("./routes/index"));
app.use("/api/apps", require("./routes/apps"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/boards", require("./routes/boards"));
app.use("/api/tests", require("./routes/tests"));
app.use("/api/testitems", require("./routes/testitems"));
app.use("/api/comparisons", require("./routes/comparisons"));
app.use("/api/power-rails", require("./routes/power-rails"));
app.use("/api/downloads", require("./routes/downloads"));
app.use("/api/powers", require("./routes/powers"));
app.use("/api/top300Test", require("./routes/top300Test"));
app.use("/api/amigoLog", require("./routes/amigoLog"));
app.use("/api/bmrelease", require("./routes/bmrelease"));
app.use("/api/chip-info", require("./routes/chip-info"));
app.use("/api/chips", require("./routes/chips"));
app.use("/api/assignees", require("./routes/assignees"));
app.use("/api/issues", require("./routes/issues"));
app.use("/api/frequency", require("./routes/frequency"));
app.use("/api/login", require("./routes/login"));
app.use("/api/tickets", require("./routes/tickets"));
app.use("/api/weekly", require("./routes/weekly"));
app.use("/api/users", require("./routes/users"));
app.use("/api/conditions", require("./routes/conditions"));
app.use("/api/interpolation", require("./routes/interpolation"));
app.use("/api/gpureplay", require("./routes/gpureplay"));
app.use("/api/ppa", require("./routes/ppa"));
app.use("/api/runner", require("./routes/runner"));
app.use("/api/powerml", require("./routes/powerml"));
app.use("/api/aiagent", require("./routes/aiagent"));

app.use("/api/admin", require("./routes/admin"));

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;
