require("rootpath")();

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
MongoClient.connect(
  process.env.MONGO_URI,
  { useNewUrlParser: true, useUnifiedTopology: true },
  (err, client) => {
    if (err) return console.error(err);
    console.log("Connected to Database");
    const db = client.db(process.env.DB_DATABASE);
    app.get("/less-visited-clients-per-day", async (req, res) => {
      const { from, to, day } = req.query;
      const weekDayNum = getDayNumber(day);

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
                $cond: [{ $eq: ["$visits.dayOfWeek", weekDayNum] }, true, false],
              },
            },
          },
          {
            $group: {
              _id: "$_id",
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
              count: 1,
            },
          },
        ])
        .toArray()
        .then((results) => {
          res.send(results);
        })
        .catch((error) => console.error(error));
    });
  }
);

app.listen(process.env.PORT, function () {
  console.log("Node server running on http://localhost:" + process.env.PORT);
});