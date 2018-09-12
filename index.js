const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { Headers } = require("node-fetch");
const { composableFetch, pipeP } = require("composable-fetch");

global.Headers = Headers;

const fetchJSON = pipeP(
  composableFetch.withHeader("Accept", "application/json"),
  composableFetch.withEncodedBody(JSON.stringify),
  composableFetch.fetch1(fetch),
  composableFetch.withSafe204(),
  composableFetch.decodeJSONResponse,
  composableFetch.checkStatus,
  ({ data }) => data,
  data => {
    if (data.status !== "OK") throw new Error("Response was not OK");
    return data;
  }
);

const memoizeP = ({ read, write }) => promise => async (...args) => {
  try {
    const key = JSON.stringify(args);

    if (read(key)) {
      console.log("from cache", key);
      return read(key);
    }

    const res = await promise(...args);
    write(key, res);
    return res;
  } catch (e) {
    throw e;
  }
};

const inMemory = (memory) => ({
  read: (key) => memory[key],
  write: (key, value) => { memory[key] = value }
})

const memoize = memoizeP(inMemory({}))

const apiKey = process.env.API_KEY;

const getPlaceDetails = memoize(async placeId => {
  const data = await fetchJSON({
    url: `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeId}&key=${apiKey}`
  });

  return {
    name: data.result.name,
    addressComponents: data.result.address_components,
    geometry: data.result.geometry
  };
});

const getPlaceSuggestions = memoize(async input => {
  const data = await fetchJSON({
    url: `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=${apiKey}`
  });

  return await Promise.all(
    data.predictions.map(({ place_id }) => place_id).map(getPlaceDetails)
  );
});

const app = express();

app.use(cors());

app.get("/suggest/:input", async (req, res) => {
  try {
    res.json(await getPlaceSuggestions(req.params.input));
  } catch (e) {
    console.error(e);
    res.status(502).json(e.message);
  }
});

app.listen(process.env.POST || 3005, () => {
  console.log("App started");
});
