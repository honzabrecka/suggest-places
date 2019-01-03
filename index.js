const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const { Headers } = require("node-fetch");
const { composableFetch } = require("composable-fetch");

global.Headers = Headers;

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
  |> then(({ data }) => data)
  |> then(checkStatus);

const memoizeP = ({ hash, read, write }) => promise => async (...args) => {
  const key = await hash(args);
  const value = await read(key);

  if (value) {
    console.log("from cache", key);
    return value;
  }

  return write(key, await promise(...args));
};

const inMemory = memory => ({
  hash: async value => JSON.stringify(value),
  read: async key => memory[key],
  write: async (key, value) => ({ ...memory, [key]: value })
});

const memoize = memoizeP(inMemory({}));

const apiKey = process.env.API_KEY;
const port = process.env.PORT || 3005;

const getPlaceDetails = memoize(async (placeId, language) => {
  const data = await fetchJSON({
    url: `https://maps.googleapis.com/maps/api/place/details/json?placeid=${placeId}&key=${apiKey}&language=${language}`
  });
  return data;
});

const formatShort = data => ({
  name: [
    data.structured_formatting.main_text,
    data.structured_formatting.secondary_text
  ]
});

const formatDetail = data => ({
  addressComponents: data.result.address_components,
  geometry: data.result.geometry
});

const getPlaceSuggestions = memoize(
  (input, language) =>
    ({
      url: `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${input}&key=${apiKey}&language=${language}`
    }
    |> fetchJSON
    |> then(({ predictions }) => predictions)
    |> then(
      map(async short => [
        short,
        await getPlaceDetails(short.place_id, language)
      ])
    )
    |> then(x => Promise.all(x))
    |> then(
      map(([short, detail]) => ({
        ...formatShort(short),
        ...formatDetail(detail)
      }))
    ))
);

const app = express();

app.use(cors());

app.get("/suggest/:input", (req, res) => {
  try {
    const language = req.query.language || "en";
    getPlaceSuggestions(req.params.input, language) |> then(x => res.json(x));
  } catch (e) {
    console.error(e);
    res.status(502).json(e.message);
  }
});

app.listen(port, () => {
  console.log(`App started http://localhost:${port}`);
});
