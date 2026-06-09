// Auto-generated manifest of the violin recordings.
// Two "worlds" (albums). Tracks are untitled in the source files, so each is
// presented as a movement with a Roman numeral and an evocative dream-name.

const DREAM_NAMES_I = [
  "Where the Night Begins", "Glass Horizon", "A Letter to the Moon",
  "Drifting, Unhurried", "Aurora in Slow Motion", "The Long Dusk",
  "Butterflies Over Still Water", "Half-Remembered", "Birds Against the Violet",
  "Lullaby for No One", "The Cloud That Stayed", "Echoes in the Reeds",
  "Suspended Light", "A Small Eternity", "Vanishing Point", "Until Morning"
];

const DREAM_NAMES_II = [
  "Beneath a Sea of Stars", "The Wandering Bow", "Mist Over the Valley",
  "Two Hands, One Breath", "Northern Quiet", "The Garden at Midnight",
  "Feathers and Frost", "Distant Bells", "Reverie", "The Last Light"
];

const ALBUMS = [
  {
    id: "world-i",
    title: "Album I",
    subtitle: "with piano",
    epigraph: "Sixteen movements for violin and piano — a long, slow nightfall.",
    accent: "#8aa6ff",
    folder: "music/myFirstClassicDisc",
    tracks: [
      { file: "track1.mp3",  dur: 158.88 }, { file: "track2.mp3",  dur: 209.01 },
      { file: "track3.mp3",  dur: 134.09 }, { file: "track4.mp3",  dur: 147.07 },
      { file: "track5.mp3",  dur: 169.09 }, { file: "track6.mp3",  dur: 232.28 },
      { file: "track7.mp3",  dur: 157.28 }, { file: "track8.mp3",  dur: 160.08 },
      { file: "track9.mp3",  dur: 161.57 }, { file: "track10.mp3", dur: 126.07 },
      { file: "track11.mp3", dur: 218.07 }, { file: "track12.mp3", dur: 130.72 },
      { file: "track13.mp3", dur: 168.91 }, { file: "track14.mp3", dur: 98.12  },
      { file: "track15.mp3", dur: 85.84  }, { file: "track16.mp3", dur: 144.61 }
    ].map((t, i) => ({ ...t, n: i + 1, name: DREAM_NAMES_I[i] }))
  },
  {
    id: "world-ii",
    title: "Album II",
    subtitle: "with chamber ensemble",
    epigraph: "Ten movements for violin and chamber group — voices gathering in the dark.",
    accent: "#9be7d4",
    folder: "music/mySecondClassicDisc",
    tracks: [
      { file: "01 Track 1.mp3",  dur: 240.01 }, { file: "02 Track 2.mp3",  dur: 172.53 },
      { file: "03 Track 3.mp3",  dur: 189.19 }, { file: "04 Track 4.mp3",  dur: 156.30 },
      { file: "05 Track 5.mp3",  dur: 175.30 }, { file: "06 Track 6.mp3",  dur: 176.10 },
      { file: "07 Track 7.mp3",  dur: 138.60 }, { file: "08 Track 8.mp3",  dur: 138.18 },
      { file: "09 Track 9.mp3",  dur: 175.71 }, { file: "10 Track 10.mp3", dur: 122.73 }
    ].map((t, i) => ({ ...t, n: i + 1, name: DREAM_NAMES_II[i] }))
  }
];

const ROMAN = ["", "I","II","III","IV","V","VI","VII","VIII","IX","X",
  "XI","XII","XIII","XIV","XV","XVI"];

function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ":" + String(sec).padStart(2, "0");
}
