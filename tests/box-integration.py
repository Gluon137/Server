"""Independent geometry/export checks across the box studio subsystems."""
from copy import deepcopy
import math
from pathlib import Path
import sys
import unittest
import xml.etree.ElementTree as ET

from shapely.geometry import Polygon, Point, box
from svgpathtools import parse_path

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'website/box-studio/backend'))
from geometry import default_project, build_project, validate_project


def feature(shape='circle', **values):
    return {'id':'probe','partId':'front','shape':shape,'operation':'cut','width':20,'height':20,
            'x':0,'y':0,'anchor':{'u':'center','v':'center'}, **values}


def board(**values):
    return {'id':'insert','name':'Einsatz','kind':'custom','host':'bottom','shape':'rect',
            'width':80,'height':50,'anchor':{'u':'center','v':'center','x':0,'y':0},
            'rotation':[90,0,0],'offset':25,'fit':'fixed','connection':'tabs',
            'motion':{'type':'fixed'}, **values}


class Integration(unittest.TestCase):
    def build(self,p):
        r=build_project(p)
        self.assertTrue(r['valid'],r['errors'])
        self.assertTrue(r['sheets'])
        return r

    def test_all_shape_and_lid_families(self):
        for shape,lids in [('rect',['none','removable','sliding','hinged']),('rounded',['none','removable']),('cylinder',['none','removable'])]:
            for lid in lids:
                with self.subTest(shape=shape,lid=lid):
                    p=default_project();p['box'].update(shape=shape,lid=lid)
                    if shape=='rounded':p['box'].update(width=160,depth=110,radius=25)
                    r=self.build(p)
                    for part in r['parts']:
                        material=Polygon(part['nominal'],part['nominalHoles'])
                        self.assertTrue(material.is_valid,part['id'])
                        self.assertGreater(material.area,0)
                    self.assertNotIn('invalid',r['checks'].values())
                    if shape!='rect':self.assertGreater(len(next(v for v in r['parts'] if v['id']=='wrap')['flexCuts']),10)

    def test_circle_toolpath_burn_is_applied_once(self):
        areas=[]
        for burn in [0,.08,.2]:
            p=default_project();p['features']=[feature()];p['material']['burn']=burn
            r=self.build(p);front=next(v for v in r['parts'] if v['id']=='front')
            hole=Polygon(front['nominalHoles'][0]);areas.append(hole.area)
            self.assertAlmostEqual(hole.centroid.x,100,places=5)
            self.assertAlmostEqual(hole.centroid.y,(p['box']['height']-p['material']['thickness'])/2,places=5)
            xmin,xmax,ymin,ymax=parse_path(front['holePaths'][0]).bbox()
            self.assertAlmostEqual(xmax-xmin,20-2*burn,places=4)
            self.assertAlmostEqual(ymax-ymin,20-2*burn,places=4)
        self.assertLess(max(areas)-min(areas),1e-6)

    def test_pattern_matches_centered_editor(self):
        p=default_project();p['features']=[feature('pattern',width=4,height=4,count=3,pitch=12)]
        front=next(v for v in self.build(p)['parts'] if v['id']=='front')
        centers=sorted(round(Polygon(h).centroid.x,5) for h in front['nominalHoles'])
        self.assertEqual(centers,[88,100,112])

    def test_edge_notch_and_nested_svg_material_islands(self):
        p=default_project();p['box']['lid']='none'
        p['features']=[feature('rect',width=10,height=10,anchor={'u':'center','v':'end'},y=0)]
        front=next(v for v in self.build(p)['parts'] if v['id']=='front')
        self.assertFalse(Polygon(front['nominal'],front['nominalHoles']).covers(Point(100,99)))
        # Even/odd SVG cutouts must not silently discard a letter's counter.
        p=default_project();p['features']=[feature('svg',contours=[
            [[-12,-12],[12,-12],[12,12],[-12,12]],
            [[-5,-5],[5,-5],[5,5],[-5,5]]])]
        r=build_project(p);self.assertFalse(r['valid'])
        self.assertTrue(any(e['code']=='DETACHED_MATERIAL' for e in r['errors']),r['errors'])

    def test_dependent_board_slots_and_resize(self):
        for width in [180,240]:
            p=default_project();p['box']['width']=width;p['parts']=[board(fit='width')]
            r=self.build(p);parts={v['id']:v for v in r['parts']};insert=parts['insert']
            self.assertAlmostEqual(insert['resolvedWidth'],width-6)
            bottom=Polygon(parts['bottom']['nominal'],parts['bottom']['nominalHoles'])
            self.assertGreater(len(parts['bottom']['nominalHoles']),1)
            tabs=Polygon(insert['nominal'],insert['nominalHoles']).intersection(box(-1,-4,width+1,-.001))
            pieces=list(tabs.geoms) if hasattr(tabs,'geoms') else [tabs]
            self.assertGreater(len(pieces),1)
            frame=insert['frame']
            for tab in pieces:
                point=tab.representative_point();x,y=point.x,point.y
                world=[frame['origin'][i]+frame['u'][i]*x+frame['v'][i]*y+frame['normal'][i]*1.5 for i in range(3)]
                self.assertGreater(world[2],0);self.assertLess(world[2],3)
                self.assertFalse(bottom.covers(Point(world[:2])))

    def test_svg_sheet_units_groups_and_operation_order(self):
        p=default_project();p['features']=[feature()];r=self.build(p)
        ns={'s':'http://www.w3.org/2000/svg'}
        found=set()
        for sheet in r['sheets']:
            svg=ET.fromstring(sheet['svg']);self.assertEqual(svg.get('width'),str(sheet['width'])+'mm')
            for group in svg.findall('./s:g/s:g',ns):
                part_id=group.get('id').removeprefix('part-');found.add(part_id)
                operations=[path.get('data-operation') for path in group.findall('s:path',ns)]
                self.assertEqual(operations[-1],'outline')
                self.assertEqual(operations.count('outline'),1)
                self.assertNotIn('helper',operations)
        self.assertEqual(found,{v['id'] for v in r['parts']})

    def test_invalid_references_and_malformed_types(self):
        for change in [lambda p:p['parts'].append(board(host={})),lambda p:p['features'].append(feature(partId=[])),
                       lambda p:p['groups'].append({'id':'g','partIds':[{}]}),
                       lambda p:p['hardware'].append({'id':'h','name':'x','quantity':1,'diameter':float('inf')})]:
            p=default_project();change(p)
            with self.assertRaises(ValueError):validate_project(p)
        p=default_project();p['parts']=[board(host='deleted')]
        result=build_project(p);self.assertFalse(result['valid'])
        self.assertTrue(any(e['code']=='HOST_MISSING' for e in result['errors']))

    def test_imported_contours_cannot_bypass_fabrication_guards(self):
        outer=[[0,0],[60,0],[60,40],[0,40]]
        tiny_hole=[[29.98,19.98],[30.02,19.98],[30.02,20.02],[29.98,20.02]]
        neck=[[0,0],[20,0],[20,19.98],[40,19.98],[40,0],[60,0],[60,40],[40,40],[40,20.02],[20,20.02],[20,40],[0,40]]
        for contours in [[outer,tiny_hole],[neck]]:
            p=default_project();p['material']['burn']=.1
            p['parts']=[board(shape='svg',width=60,height=40,rotation=[0,0,0],offset=150,connection='none',contours=contours)]
            result=build_project(p);self.assertFalse(result['valid'])
            rejected=next(v for v in result['parts'] if v['id']=='insert')
            self.assertEqual(rejected['cutPath'],'')
            self.assertFalse(any(v['partId']=='insert' for sheet in result['sheets'] for v in sheet['placements']))


if __name__=='__main__':unittest.main()
