// url=https://figma.com/design/abc?node-id=3:3
// component=Slider
// source=./Slider.jsx
const figma = require('figma')

const inst = figma.selectedInstance
const value = inst.getString('Value')
const disabled = inst.getBoolean('Disabled')
const orientation = inst.getEnum('Orientation', {
  Horizontal: 'horizontal',
  Vertical: 'vertical',
})

module.exports = figma.code`<Slider
  value={${value}}
  disabled={${disabled}}
  orientation={${orientation}}
/>`
