import { createEngine } from "./quant.js";

let engine;
self.onmessage = ({ data }) => {
  const { id, dataset, method, args } = data;
  try {
    if (dataset) engine = createEngine(dataset);
    const result = engine[method](...args);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.message || String(error) });
  }
};
