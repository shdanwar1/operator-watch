/**
 * The four master operator checklists (Operation 1).
 *
 * This file is the source of truth for the seeded content. The same content is
 * stored in `app_settings.operator_checklists`, which an admin may later edit;
 * these values are only the fallback when that row is missing.
 *
 * Each checklist is ONE flat ordered array. `heading` is a display-only label
 * (Ballet / Workout); Start and End Shift items carry no heading.
 */
import type { ChecklistConfig } from "./checklists";

const H10 = "10 Minutes Before Class";
const H5 = "5 Minutes Before Class";
const HSTART = "Class Starts";
const HDURING = "During the Class";
const HEND = "End of Class";
const HAFTER = "After the Class";

export const DEFAULT_CHECKLISTS: ChecklistConfig = {
  start_shift: {
    title: "Start Shift Checklist",
    items: [
      { id: "start_01", text: "Switch on the studio lights." },
      { id: "start_02", text: "Switch on the ceiling lights." },
      { id: "start_03", text: "Make sure the white curtains are closed and look good." },
      { id: "start_04", text: "Turn on the TV and check that it is connected to the Mac." },
      { id: "start_05", text: "Turn on the SOUNDBOKS." },
      { id: "start_06", text: "Turn on the Blackmagic Camera." },
      { id: "start_07", text: "Turn on the Rodecaster DUO." },
      { id: "start_08", text: "Turn on the YoloBox and use Monitor Mode." },
      { id: "start_09", text: "Check that the microphone transmitter is charged." },
      { id: "start_10", text: "Connect the microphone receiver to a charger." },
      { id: "start_11", text: "Prepare the microphone for the teacher." },
      { id: "start_12", text: "Log into Zoom as a participant to monitor audio." },
      {
        id: "start_13",
        text: "Confirm the YoloBox is receiving sound from USB Track and turned ON.",
      },
      { id: "start_14", text: "Make sure PGM Audio Track in the YoloBox is switched ON." },
      { id: "start_15", text: "Set YoloBox USB-C Out to UVC OUT Mode." },
      { id: "start_16", text: "4K" },
      { id: "start_17", text: "Program" },
      { id: "start_18", text: "25 fps" },
      { id: "start_19", text: "10,000 Kbps" },
      { id: "start_20", text: "H.265" },
      { id: "start_21", text: "Set YoloBox Storage to USB Storage." },
      {
        id: "start_22",
        text: "Headphones are connected to separate computer and you are logged into Zoom to monitor audio as a participant",
      },
    ],
  },

  ballet: {
    title: "Ballet Checklist",
    items: [
      {
        id: "bal_01",
        text: "Place the ballet barre exactly on the marked position",
        heading: H10,
      },
      { id: "bal_02", text: "Test the microphone with the teacher wearing it.", heading: H10 },
      { id: "bal_03", text: "Check camera framing — centered and aligned.", heading: H10 },
      {
        id: "bal_04",
        text: "Check exposure using false color meter — Green and Pink for skin.",
        heading: H10,
      },
      { id: "bal_05", text: "Prepare the timecode application to start at 01:00:00.", heading: H10 },
      {
        id: "bal_06",
        text: "Start recording in the YoloBox and start the timecode at the same time.",
        heading: H10,
      },

      { id: "bal_07", text: "Open the Class Zoom link and turn the camera ON.", heading: H5 },
      { id: "bal_08", text: "When the first person joins, unmute our microphone.", heading: H5 },
      {
        id: "bal_09",
        text: "Check and adjust the audio level using the green ring on the Rodecaster",
        heading: H5,
      },
      { id: "bal_10", text: "Time is visible for the Teacher Screen.", heading: H5 },
      { id: "bal_11", text: "Make sure the display is set to Gallery Mode.", heading: H5 },
      { id: "bal_12", text: "Confirm that the recording is running.", heading: H5 },

      {
        id: "bal_13",
        text: "Start the class 1 minute after the official starting time.",
        heading: HSTART,
      },
      { id: "bal_14", text: "Mute all participants.", heading: HSTART },
      { id: "bal_15", text: "Enable Mute all upon entry.", heading: HSTART },
      {
        id: "bal_16",
        text: "Disable participants' ability to unmute themselves.",
        heading: HSTART,
      },
      { id: "bal_17", text: "Audio mode set to Original Sound for Musicians.", heading: HSTART },
      { id: "bal_18", text: "Run the class even if there are no participants.", heading: HSTART },

      { id: "bal_19", text: "Monitor the stream and audio.", heading: HDURING },
      {
        id: "bal_20",
        text: "Fade out the music on the Rodecaster when finishing instead of using the pause button.",
        heading: HDURING,
      },
      { id: "bal_21", text: 'Notify the teacher: "5 min left".', heading: HDURING },

      { id: "bal_22", text: "The final exercise is always Révérence.", heading: HEND },
      {
        id: "bal_23",
        text: "Play the Révérence music via Apple Music until applause is over.",
        heading: HEND,
      },
      { id: "bal_24", text: "Ask to unmute everybody.", heading: HEND },
      { id: "bal_25", text: "Allow 5 minutes for Q&A.", heading: HEND },
      { id: "bal_26", text: "Stop recording only after the Q&A has finished.", heading: HEND },

      { id: "bal_27", text: "Rename the file.", heading: HAFTER },
      { id: "bal_28", text: "Upload to Google Drive.", heading: HAFTER },
    ],
  },

  workout: {
    title: "Workout Checklist",
    items: [
      { id: "work_01", text: "Place the Yoga Mat centre aligned.", heading: H10 },
      { id: "work_02", text: "Test the microphone with the teacher wearing it.", heading: H10 },
      { id: "work_03", text: "Check camera framing — centered and aligned.", heading: H10 },
      {
        id: "work_04",
        text: "Check exposure using false color meter — Green and Pink for skin.",
        heading: H10,
      },
      { id: "work_05", text: "Start recording in the YoloBox.", heading: H10 },

      { id: "work_06", text: "Open the Zoom link.", heading: H5 },
      {
        id: "work_07",
        text: "When the first person joins the Zoom call, unmute our microphone.",
        heading: H5,
      },
      {
        id: "work_08",
        text: "Check and adjust the audio level using the green ring on the Rodecaster.",
        heading: H5,
      },
      { id: "work_09", text: "Time is visible for the Teacher Screen.", heading: H5 },
      { id: "work_10", text: "Make sure the display is set to Gallery Mode.", heading: H5 },
      { id: "work_11", text: "Make sure the chat is open.", heading: H5 },
      { id: "work_12", text: "Confirm that the recording is running.", heading: H5 },

      {
        id: "work_13",
        text: "Start the class 1 minute after the official starting time.",
        heading: HSTART,
      },
      { id: "work_14", text: "Mute all participants.", heading: HSTART },
      {
        id: "work_15",
        text: "Enable Mute all upon entry and disable unmuting.",
        heading: HSTART,
      },
      { id: "work_16", text: "Change audio to Original Sound for Musicians.", heading: HSTART },
      { id: "work_17", text: "Run the class even if there are no participants.", heading: HSTART },
      { id: "work_18", text: "Start the Workout Playlist.", heading: HSTART },

      { id: "work_19", text: "Monitor the volume level for loud music tracks.", heading: HDURING },
      { id: "work_20", text: 'Show the teacher the "5 min left" note.', heading: HDURING },

      { id: "work_21", text: "Ask to unmute everybody.", heading: HEND },
      { id: "work_22", text: "Allow 5 minutes for Q&A.", heading: HEND },
      { id: "work_23", text: "Stop recording only after the Q&A has finished.", heading: HEND },

      { id: "work_24", text: "Rename the file.", heading: HAFTER },
      { id: "work_25", text: "Upload to Google Drive.", heading: HAFTER },
    ],
  },

  end_shift: {
    title: "End Shift Checklist",
    items: [
      { id: "end_01", text: "Charge RODE mic." },
      { id: "end_02", text: "Rename the recordings." },
      { id: "end_03", text: "Upload files via browser." },
      { id: "end_04", text: "Back up files to the big hard drive if SSD Drive is full" },
      { id: "end_05", text: "Take a wet towel and clean the microphones and the table." },
      { id: "end_06", text: "Check if there's any rubbish and throw it away." },
      { id: "end_07", text: "Turn the security camera in the operator room back ON." },
      { id: "end_08", text: "Turn all lights OFF." },
      { id: "end_09", text: "Check if bins (bathroom and studio) need to be put out / change bags." },
      { id: "end_10", text: "Check if there's enough hand towels and toilet paper." },
    ],
  },
};
