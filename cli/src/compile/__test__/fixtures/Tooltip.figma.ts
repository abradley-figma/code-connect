// url=https://figma.com/design/abc?node-id=4:4
// component=Tooltip
// source=./Tooltip.tsx
//
// Canonical export shape per https://developers.figma.com/docs/code-connect/template-files/
// — `code-connect publish` emits this form by default.
import figma from 'figma'

const title = figma.selectedInstance.getString('Title')
const placement = figma.selectedInstance.getEnum('Placement', {
  Top: 'top',
  Right: 'right',
  Bottom: 'bottom',
  Left: 'left',
})
const disabled = figma.selectedInstance.getBoolean('Disabled')

export default {
  example: figma.code`<Tooltip
  title={${title}}
  placement={${placement}}
  disabled={${disabled}}
/>`,
  imports: ['import { Tooltip } from "@app/ui"'],
  id: 'tooltip',
  metadata: { nestable: true },
}
