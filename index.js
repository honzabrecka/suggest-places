const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { Headers } = require("node-fetch");
const { composableFetch } = require("composable-fetch");

global.Headers = Headers;

const prop = name => o => o[name];

const map = f => functor => functor.map(f);

const then = f => promise => promise.then(f);

const checkStatus = data => {
  if (data.status !== "OK") throw new Error("Response was not OK");
  return data;
};

const fetchJSON = req =>
  req
  |> composableFetch.withHeader("Accept", "application/json")
  |> composableFetch.withEncodedBody(JSON.stringify)
  |> composableFetch.fetch1(fetch)
  |> then(composableFetch.withSafe204())
  |> then(composableFetch.decodeJSONResponse)
  |> then(composableFetch.checkStatus)
  |> then(prop("data"))
  |> then(checkStatus);

const memoizeP = ({ hash, read, write }) => promise => async (...args) => {
  try {
    const key = await hash(args);
    const value = await read(key);

    if (value) {
      console.log("from cache", key);
      return value;
    }

    return write(key, await promise(...args));
  } catch (e) {
    throw e;
  }
};

const inMemory = memory => ({
  hash: async value => JSON.stringify(value),
  read: async key => memory[key],
  write: async (key, value) => {
    memory[key] = value;
    return value;
  }
});

const memoize = memoizeP(inMemory({}));

const apiKey = process.env.API_KEY;
const port = process.env.PORT || 3005;

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

const getPlaceSuggestions = memoize(
  input =>
    ({
      url: `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=${apiKey}`
    }
    |> fetchJSON
    |> then(prop("predictions"))
    |> then(map(prop("place_id")))
    |> then(map(getPlaceDetails))
    |> then(x => Promise.all(x)))
);

const app = express();

app.use(cors());

app.get("/suggest/:input", (req, res) => {
  try {
    req.params.input |> getPlaceSuggestions |> then(x => res.json(x));
  } catch (e) {
    console.error(e);
    res.status(502).json(e.message);
  }
});

app.listen(port, () => {
  console.log(`App started http://localhost:${port}`);
});
