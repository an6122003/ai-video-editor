// Project config for the An À Ha video builder. This is the only file you edit
// besides cards.data.mjs (content + timing) and logos.json (brand marks).
import { CARDS } from "./cards.data.mjs";

export default {
  outDir: "build",
  videoSrc: "input-video.mp4",
  duration: 144.73,
  fps: 30,

  CARDS,

  // One dominant accent per card. White default; navy for data + closings;
  // yellow spent once; glass where the footage is still doing work.
  SURFACE: {
    "card-01": "dark",   "card-02": "glass",  "card-03": "glass",
    "card-04": "glass",  "card-05": "dark",   "card-06": "glass",
    "card-07": "blue",   "card-08": "white",  "card-09": "dark",
    "card-10": "band",   "card-11": "band",   "card-12": "band",
    "card-13": "band",   "card-14": "band",   "card-15": "dark",
    "card-16": "yellow", "card-17": "dark",   "card-18": "glass",
    "card-19": "glass",  "card-20": "blue",   "card-21": "glass",
    "card-22": "dark",
  },

  // The stretch where the speaker shrinks to a corner pill so data owns the
  // frame. Omit `pipSection` entirely for a video that never does this.
  pipSection: { lift: 62.45, in: 62.55, inDur: 0.75, out: 91.6, outDur: 0.7, drop: 92.35 },
};
