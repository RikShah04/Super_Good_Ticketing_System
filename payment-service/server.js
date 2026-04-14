import express from "express";

const app = express();
const port = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', async (req, res) => {
  try {
    res.send("Working");
  } catch (err) {
    console.error(err);
    res.status(500).send('An error ocurred');
  }
});

app.listen(port, () => {
  console.log(`Payment Service API running on port ${port}`);
});