"use client";

/** Ticks or clears every "Select" box that belongs to the given form. */
export function SelectAll({ form }: { form: string }) {
  return (
    <label className="flex items-center gap-2 text-muted">
      <input
        type="checkbox"
        onChange={(e) => {
          for (const box of document.querySelectorAll<HTMLInputElement>(`input[type="checkbox"][name="ids"][form="${form}"]`)) {
            box.checked = e.target.checked;
          }
        }}
      />
      Select all
    </label>
  );
}
