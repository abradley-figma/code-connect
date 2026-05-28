// url=https://figma.com/design/abc?node-id=3:3
// component=Avatar
import figma from 'figma'

const size = figma.selectedInstance.getEnum('Size', { Sm: 24, Md: 32, Lg: 48 })
const src = figma.selectedInstance.getString('Src')

export default figma.code`<Avatar size={${size}} src={${src}} />`
