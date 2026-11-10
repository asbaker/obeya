// Machine 4 (lib/page-machines.mjs): which dialog is open over the canvas.
import { createMachine } from "/lib/machine.mjs";
import { DIALOGS } from "/lib/page-machines.mjs";

export const dialogs = createMachine(DIALOGS);
// Open one unless another is already open (then nothing happens).
export const openDialog = (event) => dialogs.can(event) && dialogs.send(event);
export const closeDialog = () => dialogs.can("CLOSE") && dialogs.send("CLOSE");
