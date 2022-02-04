require("rootpath")();

const NodeCache = require("node-cache");
const dotenv = require("dotenv");
dotenv.config();

var express = require("express"),
  app = express(),
  fs = require("fs"),
  cors = require("cors"),
  morgan = require("morgan"),
  bodyParser = require("body-parser"),
  methodOverride = require("method-override"),
  router = express.Router();
const MongoClient = require("mongodb").MongoClient;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use(morgan("dev"));
app.use(methodOverride());
app.use(router);
app.use(cors());

function getDayNumber(day) {
  switch (day.toLowerCase()) {
    case "sunday":
      return 1;
    case "monday":
      return 2;
    case "tuesday":
      return 3;
    case "wednesday":
      return 4;
    case "thursday":
      return 5;
    case "friday":
      return 6;
    case "saturday":
      return 7;
    default:
      return 0;
  }
}

const reportCache = new NodeCache();

const simulateAsyncPause = () =>
  new Promise((resolve) => {
    setTimeout(() => resolve(), 1000);
  });

MongoClient.connect(
  process.env.MONGO_URI,
  { useNewUrlParser: true, useUnifiedTopology: true },
  async (err, client) => {
    if (err) return console.error(err);
    console.log("Connected to Database");
    const db = client.db(process.env.DB_DATABASE);
    visitsStream = db.collection("visits").watch();
    visitsStream.on("change", (next) => {
      console.log("received a change to the collection: \t", next);
      reportCache.flushAll();
    });
    app.get("/less-visited-clients-per-day", async (req, res) => {
      const { from, to, day } = req.query;
      const weekDayNum = getDayNumber(day);
      const cahcedReport = await reportCache.get(`${from}-${to}-${weekDayNum}`);

      if (cahcedReport) {
        return res.send(cahcedReport);
      } else {
        await db
          .collection("clients")
          .aggregate([
            {
              $lookup: {
                from: "visits",
                localField: "_id",
                foreignField: "client",
                as: "visits",
              },
            },
            {
              $unwind: {
                path: "$visits",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $match: {
                "visits.time": { $gte: parseFloat(from), $lte: parseFloat(to) },
              },
            },
            {
              $addFields: {
                "visits.convertedDate": { $toDate: "$visits.time" },
              },
            },
            {
              $addFields: {
                "visits.dayOfWeek": { $dayOfWeek: "$visits.convertedDate" },
              },
            },
            {
              $addFields: {
                "visits.visited": {
                  $cond: [
                    { $eq: ["$visits.dayOfWeek", weekDayNum] },
                    true,
                    false,
                  ],
                },
              },
            },
            {
              $group: {
                _id: "$_id",
                countVisit: {
                  $sum: { $cond: ["$visits.visited", 1, 0] },
                },
                visits: {
                  $push: {
                    $cond: [
                      { $eq: ["$visits.visited", true] },
                      { visits: "$visits" },
                      null,
                    ],
                  },
                },
              },
            },

            {
              $project: {
                visits: { $setDifference: ["$visits", [null]] },
                countVisit: 1,
              },
            },
            { $sort: { countVisit: 1 } },
          ])
          .toArray()
          .then((results) => {
            reportCache.set(`${from}-${to}-${weekDayNum}`, results);
            res.send(results);
          })
          .catch((error) => console.error(error));
      }
    });
  }
);

app.listen(process.env.PORT, function () {
  console.log("Node server running on http://localhost:" + process.env.PORT);
});
