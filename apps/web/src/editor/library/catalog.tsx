// Library catalog: placeable items (shape profiles, 3D solids, furniture, lights, structure) shared
// by the Add popover, the Library panel and the command palette.
import type { ReactNode } from 'react'
import {
  Armchair,
  Bath,
  BedDouble,
  BedSingle,
  Bike,
  Box,
  Car,
  Circle,
  Cone,
  CookingPot,
  Cylinder,
  Flower2,
  Heart,
  Image,
  LampCeiling,
  LampFloor,
  Lightbulb,
  Microwave,
  MoveUpRight,
  Pentagon,
  PersonStanding,
  Piano,
  Pill,
  Plus,
  Pyramid,
  Refrigerator,
  ShowerHead,
  Sofa,
  Square,
  Star,
  Sun,
  SunMedium,
  Toilet,
  Torus,
  TreeDeciduous,
  Triangle,
  Tv,
  WashingMachine,
  Zap,
} from 'lucide-react'
import type { FurnitureKind, LightKind, NewNode } from '@cadsandbox/doc'
import { FURNITURE_SIZES } from '@cadsandbox/doc'
import {
  IconChair,
  IconCoffeeTable,
  IconColumn,
  IconBeam,
  IconDesk,
  IconDiningTable,
  IconDishwasher,
  IconDresser,
  IconKitchenBase,
  IconKitchenIsland,
  IconKitchenWall,
  IconLoft,
  IconNightstand,
  IconRevolve,
  IconRing,
  IconRug,
  IconSection,
  IconShelf,
  IconSink,
  IconSphere,
  IconStool,
  IconText3D,
  IconTube,
  IconWardrobe,
  IconWashbasin,
  IconTerrain,
} from './icons'

export interface CatalogItem {
  id: string
  /** i18n key */
  key: string
  fallback: string
  icon: ReactNode
  node: NewNode
  keywords?: string[]
}

const item = (id: string, fallback: string, icon: ReactNode, node: NewNode, keywords?: string[]): CatalogItem => ({ id, key: `library.item.${id}`, fallback, icon, node, keywords })

/** Spline-style "Simple forms": 2D profiles extruded a little (depth 0.2 m). */
export const SHAPE_ITEMS: CatalogItem[] = [
  item('shape.rect', 'Rectangle', <Square />, { type: 'shape', name: 'Rectangle', params: { profile: 'rect', width: 1, height: 1, depth: 0.2, cornerRadius: 0.05 } }),
  item('shape.circle', 'Circle', <Circle />, { type: 'shape', name: 'Circle', params: { profile: 'circle', width: 1, height: 1, depth: 0.2 } }),
  item('shape.triangle', 'Triangle', <Triangle />, { type: 'shape', name: 'Triangle', params: { profile: 'triangle', width: 1, height: 1, depth: 0.2 } }),
  item('shape.polygon', 'Poly', <Pentagon />, { type: 'shape', name: 'Polygon', params: { profile: 'polygon', width: 1, height: 1, sides: 6, depth: 0.2 } }, ['hexagon', 'pentagon']),
  item('shape.heart', 'Heart', <Heart />, { type: 'shape', name: 'Heart', params: { profile: 'heart', width: 1, height: 1, depth: 0.2 } }),
  item('shape.star', 'Star', <Star />, { type: 'shape', name: 'Star', params: { profile: 'star', width: 1, height: 1, sides: 5, innerRatio: 0.5, depth: 0.2 } }),
  item('shape.arrow', 'Arrow', <MoveUpRight />, { type: 'shape', name: 'Arrow', params: { profile: 'arrow', width: 1, height: 0.6, depth: 0.2 } }),
  item('shape.cross', 'Cross', <Plus />, { type: 'shape', name: 'Cross', params: { profile: 'cross', width: 1, height: 1, depth: 0.2 } }),
  item('shape.ring', 'Ring', <IconRing />, { type: 'shape', name: 'Ring', params: { profile: 'ring', width: 1, height: 1, innerRatio: 0.6, depth: 0.2 } }),
]

export const SOLID_ITEMS: CatalogItem[] = [
  item('solid.box', 'Box', <Box />, { type: 'primitive', name: 'Box', params: { shape: 'box', width: 1, depth: 1, height: 1 } }, ['cube']),
  item('solid.sphere', 'Sphere', <IconSphere />, { type: 'primitive', name: 'Sphere', params: { shape: 'sphere', radius: 0.5 } }, ['ball']),
  item('solid.cylinder', 'Cylinder', <Cylinder />, { type: 'primitive', name: 'Cylinder', params: { shape: 'cylinder', radius: 0.5, height: 1 } }),
  item('solid.cone', 'Cone', <Cone />, { type: 'primitive', name: 'Cone', params: { shape: 'cone', radius: 0.5, radius2: 0, height: 1 } }),
  item('solid.torus', 'Torus', <Torus />, { type: 'primitive', name: 'Torus', params: { shape: 'torus', radius: 0.5, radius2: 0.15 } }, ['donut']),
  item('solid.capsule', 'Capsule', <Pill />, { type: 'primitive', name: 'Capsule', params: { shape: 'capsule', radius: 0.25, height: 1 } }),
  item('solid.pyramid', 'Pyramid', <Pyramid />, { type: 'primitive', name: 'Pyramid', params: { shape: 'pyramid', width: 1, depth: 1, height: 1, sides: 4 } }),
  item('solid.tube', 'Tube', <IconTube />, { type: 'primitive', name: 'Tube', params: { shape: 'tube', radius: 0.5, radius2: 0.4, height: 1 } }, ['pipe']),
  item('solid.revolve', 'Revolve', <IconRevolve />, { type: 'revolve', name: 'Revolve' }, ['vase', 'lathe']),
  item('solid.loft', 'Loft', <IconLoft />, { type: 'loft', name: 'Loft' }),
  item('solid.text', '3D Text', <IconText3D />, { type: 'text', name: 'Text', params: { text: 'Text', size: 0.5, depth: 0.1, font: 'display', align: 'center' } }),
]

export const STRUCTURE_ITEMS: CatalogItem[] = [
  item('arch.column', 'Column', <IconColumn />, { type: 'column', name: 'Column' }),
  item('arch.beam', 'Beam', <IconBeam />, { type: 'beam', name: 'Beam' }),
  item('arch.section', 'Section plane', <IconSection />, { type: 'section', name: 'Section A' }),
  item('arch.terrain', 'Terrain', <IconTerrain />, { type: 'terrain', name: 'Terrain', params: { width: 30, depth: 30, heights: [], resolution: 0 } }, ['site', 'ground']),
  item('arch.image', 'Reference image', <Image />, { type: 'image', name: 'Underlay', params: { asset: '', width: 4, height: 3, opacity: 0.7, planOnly: true } }, ['underlay', 'plan']),
]

const light = (kind: LightKind, label: string, icon: ReactNode, params: Partial<NewNode<'light'>['params'] & object>): CatalogItem =>
  item(`light.${kind}`, label, icon, { type: 'light', name: label, params: { kind, ...params } })

export const LIGHT_ITEMS: CatalogItem[] = [
  light('point', 'Point light', <Lightbulb />, { intensity: 60 }),
  light('spot', 'Spot light', <Zap />, { intensity: 120, angle: Math.PI / 5 }),
  light('directional', 'Sun light', <Sun />, { intensity: 50000 }),
  light('area', 'Area light', <SunMedium />, { intensity: 400, width: 1, height: 1 }),
]

// ------------------------------------------------------------------ furniture
export const FURNITURE_ICONS: Record<FurnitureKind, ReactNode> = {
  sofa: <Sofa />,
  armchair: <Armchair />,
  chair: <IconChair />,
  stool: <IconStool />,
  'dining-table': <IconDiningTable />,
  'coffee-table': <IconCoffeeTable />,
  desk: <IconDesk />,
  'bed-single': <BedSingle />,
  'bed-double': <BedDouble />,
  nightstand: <IconNightstand />,
  wardrobe: <IconWardrobe />,
  shelf: <IconShelf />,
  dresser: <IconDresser />,
  'tv-unit': <Tv />,
  'kitchen-base': <IconKitchenBase />,
  'kitchen-wall': <IconKitchenWall />,
  'kitchen-island': <IconKitchenIsland />,
  fridge: <Refrigerator />,
  stove: <CookingPot />,
  oven: <Microwave />,
  dishwasher: <IconDishwasher />,
  sink: <IconSink />,
  toilet: <Toilet />,
  washbasin: <IconWashbasin />,
  bathtub: <Bath />,
  shower: <ShowerHead />,
  'washing-machine': <WashingMachine />,
  plant: <Flower2 />,
  tree: <TreeDeciduous />,
  'lamp-floor': <LampFloor />,
  'lamp-pendant': <LampCeiling />,
  rug: <IconRug />,
  piano: <Piano />,
  car: <Car />,
  person: <PersonStanding />,
  bicycle: <Bike />,
}

export const FURNITURE_LABELS: Record<FurnitureKind, string> = {
  sofa: 'Sofa',
  armchair: 'Armchair',
  chair: 'Chair',
  stool: 'Stool',
  'dining-table': 'Dining table',
  'coffee-table': 'Coffee table',
  desk: 'Desk',
  'bed-single': 'Single bed',
  'bed-double': 'Double bed',
  nightstand: 'Nightstand',
  wardrobe: 'Wardrobe',
  shelf: 'Shelf',
  dresser: 'Dresser',
  'tv-unit': 'TV unit',
  'kitchen-base': 'Kitchen base unit',
  'kitchen-wall': 'Kitchen wall unit',
  'kitchen-island': 'Kitchen island',
  fridge: 'Fridge',
  stove: 'Stove',
  oven: 'Oven',
  dishwasher: 'Dishwasher',
  sink: 'Kitchen sink',
  toilet: 'Toilet',
  washbasin: 'Washbasin',
  bathtub: 'Bathtub',
  shower: 'Shower',
  'washing-machine': 'Washing machine',
  plant: 'Plant',
  tree: 'Tree',
  'lamp-floor': 'Floor lamp',
  'lamp-pendant': 'Pendant lamp',
  rug: 'Rug',
  piano: 'Piano',
  car: 'Car',
  person: 'Person',
  bicycle: 'Bicycle',
}

export interface FurnitureCategory {
  id: string
  key: string
  fallback: string
  kinds: FurnitureKind[]
}

export const FURNITURE_CATEGORIES: FurnitureCategory[] = [
  { id: 'living', key: 'library.furniture.living', fallback: 'Living', kinds: ['sofa', 'armchair', 'coffee-table', 'tv-unit', 'shelf', 'rug', 'lamp-floor', 'lamp-pendant', 'piano', 'plant'] },
  { id: 'dining', key: 'library.furniture.dining', fallback: 'Dining & Office', kinds: ['dining-table', 'chair', 'stool', 'desk'] },
  { id: 'bedroom', key: 'library.furniture.bedroom', fallback: 'Bedroom', kinds: ['bed-single', 'bed-double', 'nightstand', 'wardrobe', 'dresser'] },
  { id: 'kitchen', key: 'library.furniture.kitchen', fallback: 'Kitchen', kinds: ['kitchen-base', 'kitchen-wall', 'kitchen-island', 'fridge', 'stove', 'oven', 'dishwasher', 'sink'] },
  { id: 'bath', key: 'library.furniture.bath', fallback: 'Bathroom', kinds: ['toilet', 'washbasin', 'bathtub', 'shower', 'washing-machine'] },
  { id: 'outdoor', key: 'library.furniture.outdoor', fallback: 'Outdoor & People', kinds: ['tree', 'car', 'bicycle', 'person'] },
]

export function furnitureNode(kind: FurnitureKind): NewNode<'furniture'> {
  const [width, depth, height] = FURNITURE_SIZES[kind]
  return { type: 'furniture', name: FURNITURE_LABELS[kind], params: { kind, width, depth, height } }
}

export function furnitureItem(kind: FurnitureKind): CatalogItem {
  return item(`furniture.${kind}`, FURNITURE_LABELS[kind], FURNITURE_ICONS[kind], furnitureNode(kind))
}

export const FURNITURE_ITEMS: CatalogItem[] = (Object.keys(FURNITURE_SIZES) as FurnitureKind[]).map(furnitureItem)

export const ALL_CATALOG_ITEMS: CatalogItem[] = [...SHAPE_ITEMS, ...SOLID_ITEMS, ...STRUCTURE_ITEMS, ...LIGHT_ITEMS, ...FURNITURE_ITEMS]
