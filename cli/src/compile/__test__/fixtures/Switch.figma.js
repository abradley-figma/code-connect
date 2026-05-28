// url=https://figma.com/design/abc?node-id=2:2
// component=Switch
// source=./Switch.jsx
import figma from 'figma'

const inst = figma.selectedInstance
const checked = inst.getBoolean('Checked')
const disabled = inst.getBoolean('Disabled')
const label = inst.getString('Label')
const size = inst.getEnum('Size', { Sm: 'sm', Md: 'md', Lg: 'lg' })

export default figma.code`<Switch
  checked={${checked}}
  disabled={${disabled}}
  label={${label}}
  size={${size}}
/>`
