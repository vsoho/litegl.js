/**
* @namespace GL
*/

/**
*   Octree generator for fast ray triangle collision with meshes
*	Dependencies: glmatrix.js (for vector and matrix operations)
* @class Octree
* @constructor
* @param {Mesh} mesh object containing vertices buffer (indices buffer optional)
*/

global.Octree = GL.Octree = function Octree( mesh )
{
	this.root = null;
	this.total_depth = 0;
	this.total_nodes = 0;
	if(mesh)
	{
		this.buildFromMesh(mesh);
		this.total_nodes = this.trim();
	}
}

Octree.MAX_NODE_TRIANGLES_RATIO = 0.1;
Octree.MAX_OCTREE_DEPTH = 8;
Octree.OCTREE_MARGIN_RATIO = 0.01;
Octree.OCTREE_MIN_MARGIN = 0.1;

var octree_tested_boxes = 0;
var octree_tested_triangles = 0;

Octree.prototype.buildFromMesh = function( mesh )
{
	this.total_depth = 0;
	this.total_nodes = 0;

	var vertices = mesh.getBuffer("vertices").data;
	var triangles = mesh.getIndexBuffer("triangles");
	if(triangles) 
		triangles = triangles.data; //get the internal data

	var root = this.computeAABB(vertices);
	this.root = root;
	this.total_nodes = 1;
	this.total_triangles = triangles ? triangles.length / 3 : vertices.length / 9;
	this.max_node_triangles = this.total_triangles * Octree.MAX_NODE_TRIANGLES_RATIO;

	var margin = vec3.create();
	vec3.scale( margin, root.size, Octree.OCTREE_MARGIN_RATIO );
	if(margin[0] < Octree.OCTREE_MIN_MARGIN) margin[0] = Octree.OCTREE_MIN_MARGIN;
	if(margin[1] < Octree.OCTREE_MIN_MARGIN) margin[1] = Octree.OCTREE_MIN_MARGIN;
	if(margin[2] < Octree.OCTREE_MIN_MARGIN) margin[2] = Octree.OCTREE_MIN_MARGIN;

	vec3.sub(root.min, root.min, margin);
	vec3.add(root.max, root.max, margin);

	root.faces = [];
	root.inside = 0;


	//indexed
	if(triangles)
	{
		for(var i = 0; i < triangles.length; i+=3)
		{
			var face = new Float32Array([vertices[triangles[i]*3], vertices[triangles[i]*3+1],vertices[triangles[i]*3+2],
						vertices[triangles[i+1]*3], vertices[triangles[i+1]*3+1],vertices[triangles[i+1]*3+2],
						vertices[triangles[i+2]*3], vertices[triangles[i+2]*3+1],vertices[triangles[i+2]*3+2]]);
			this.addToNode(face,root,0);
		}
	}
	else
	{
		for(var i = 0; i < vertices.length; i+=9)
		{
			var face = new Float32Array( vertices.subarray(i,i+9) );
			this.addToNode(face,root,0);
		}
	}

	return root;
}

Octree.prototype.addToNode = function(face,node, depth)
{
	node.inside += 1;

	//has children
	if(node.c)
	{
		var aabb = this.computeAABB(face);
		var added = false;
		for(var i in node.c)
		{
			var child = node.c[i];
			if (Octree.isInsideAABB(aabb,child))
			{
				this.addToNode(face,child, depth+1);
				added = true;
				break;
			}
		}
		if(!added)
		{
			if(node.faces == null)
				node.faces = [];
			node.faces.push(face);
		}
	}
	else //add till full, then split
	{
		if(node.faces == null) node.faces = [];
		node.faces.push(face);

		//split
		if(node.faces.length > this.max_node_triangles && depth < Octree.MAX_OCTREE_DEPTH)
		{
			this.splitNode(node);
			if(this.total_depth < depth + 1)
				this.total_depth = depth + 1;

			var faces = node.faces.concat();
			node.faces = null;

			//redistribute all nodes
			for(var i in faces)
			{
				var face = faces[i];
				var aabb = this.computeAABB(face);
				var added = false;
				for(var j in node.c)
				{
					var child = node.c[j];
					if (Octree.isInsideAABB(aabb,child))
					{
						this.addToNode(face,child, depth+1);
						added = true;
						break;
					}
				}
				if (!added)
				{
					if(node.faces == null)
						node.faces = [];
					node.faces.push(face);
				}
			}
		}
	}
};

Octree.prototype.octree_pos_ref = [[0,0,0],[0,0,1],[0,1,0],[0,1,1],[1,0,0],[1,0,1],[1,1,0],[1,1,1]];

Octree.prototype.splitNode = function(node)
{
	node.c = [];
	var half = [(node.max[0] - node.min[0]) * 0.5, (node.max[1] - node.min[1]) * 0.5, (node.max[2] - node.min[2]) * 0.5];

	for(var i in this.octree_pos_ref)
	{
		var ref = this.octree_pos_ref[i];

		var newnode = {};
		this.total_nodes += 1;

		newnode.min = [ node.min[0] + half[0] * ref[0],  node.min[1] + half[1] * ref[1],  node.min[2] + half[2] * ref[2]];
		newnode.max = [newnode.min[0] + half[0], newnode.min[1] + half[1], newnode.min[2] + half[2]];
		newnode.faces = null;
		newnode.inside = 0;
		node.c.push(newnode);
	}
}

Octree.prototype.computeAABB = function(vertices)
{
	var min = new Float32Array([ vertices[0], vertices[1], vertices[2] ]);
	var max = new Float32Array([ vertices[0], vertices[1], vertices[2] ]);

	for(var i = 0; i < vertices.length; i+=3)
	{
		for(var j = 0; j < 3; j++)
		{
			if(min[j] > vertices[i+j]) 
				min[j] = vertices[i+j];
			if(max[j] < vertices[i+j]) 
				max[j] = vertices[i+j];
		}
	}

	return {min: min, max: max, size: vec3.sub( vec3.create(), max, min) };
}

//remove empty nodes
Octree.prototype.trim = function(node)
{
	node = node || this.root;
	if(!node.c)
		return 1;

	var num = 1;
	var valid = [];
	var c = node.c;
	for(var i = 0; i < c.length; ++i)
	{
		if(c[i].inside)
		{
			valid.push(c[i]);
			num += this.trim(c[i]);
		}
	}
	node.c = valid;
	return num;
}

/**
* Test collision between ray and triangles in the octree
* @method testRay
* @param {vec3} origin ray origin position
* @param {vec3} direction ray direction position
* @param {number} dist_min
* @param {number} dist_max
* @return {HitTest} object containing pos and normal
*/
Octree.prototype.testRay = (function(){ 
	var origin_temp = vec3.create();
	var direction_temp = vec3.create();
	var min_temp = vec3.create();
	var max_temp = vec3.create();

	return function(origin, direction, dist_min, dist_max, test_backfaces )
	{
		octree_tested_boxes = 0;
		octree_tested_triangles = 0;

		if(!this.root)
		{
			throw("Error: octree not build");
		}

		origin_temp.set( origin );
		direction_temp.set( direction );
		min_temp.set( this.root.min );
		max_temp.set( this.root.max );

		var test = Octree.hitTestBox( origin_temp, direction_temp, min_temp, max_temp );
		if(!test) //no collision with mesh bounding box
			return null;

		var test = Octree.testRayInNode( this.root, origin_temp, direction_temp, test_backfaces );
		if(test != null)
		{
			var pos = vec3.scale( vec3.create(), direction, test.t );
			vec3.add( pos, pos, origin );
			test.pos = pos;
			return test;
		}

		return null;
	}
})();

/**
* test collision between sphere and the triangles in the octree (only test if there is any vertex inside the sphere)
* @method testSphere
* @param {vec3} origin sphere center
* @param {number} radius
* @return {Boolean} true if the sphere collided with the mesh
*/
Octree.prototype.testSphere = function( origin, radius )
{
	origin = vec3.clone(origin);
	octree_tested_boxes = 0;
	octree_tested_triangles = 0;

	if(!this.root)
		throw("Error: octree not build");

	//better to use always the radius squared, because all the calculations are going to do that
	var rr = radius * radius;

	if( !Octree.testSphereBox( origin, rr, vec3.clone(this.root.min), vec3.clone(this.root.max) ) )
		return false; //out of the box

	return Octree.testSphereInNode( this.root, origin, rr );
}

//WARNING: cannot use static here, it uses recursion
Octree.testRayInNode = function( node, origin, direction, test_backfaces )
{
	var test = null;
	var prev_test = null;
	octree_tested_boxes += 1;

	//test faces
	if(node.faces)
		for(var i = 0, l = node.faces.length; i < l; ++i)
		{
			var face = node.faces[i];
			octree_tested_triangles += 1;
			test = Octree.hitTestTriangle( origin, direction, face.subarray(0,3) , face.subarray(3,6), face.subarray(6,9), test_backfaces );
			if (test==null)
				continue;
			test.face = face;
			if(prev_test)
				prev_test.mergeWith( test );
			else
				prev_test = test;
		}

	//WARNING: cannot use statics here, this function uses recursion
	var child_min = vec3.create();
	var child_max = vec3.create();

	//test children nodes faces
	var child;
	if(node.c)
		for(var i = 0; i < node.c.length; ++i)
		{
			child = node.c[i];
			child_min.set( child.min );
			child_max.set( child.max );

			//test with node box
			test = Octree.hitTestBox( origin, direction, child_min, child_max );
			if( test == null )
				continue;

			//nodebox behind current collision, then ignore node
			if(prev_test && test.t > prev_test.t)
				continue;

			//test collision with node
			test = Octree.testRayInNode( child, origin, direction, test_backfaces );
			if(test == null)
				continue;

			if(prev_test)
				prev_test.mergeWith( test );
			else
				prev_test = test;
		}

	return prev_test;
}

//WARNING: cannot use static here, it uses recursion
Octree.testSphereInNode = function( node, origin, radius2 )
{
	var test = null;
	var prev_test = null;
	octree_tested_boxes += 1;

	//test faces
	if(node.faces)
		for(var i = 0, l = node.faces.length; i < l; ++i)
		{
			var face = node.faces[i];
			octree_tested_triangles += 1;
			if( Octree.testSphereTriangle( origin, radius2, face.subarray(0,3) , face.subarray(3,6), face.subarray(6,9) ) )
				return true;
		}

	//WARNING: cannot use statics here, this function uses recursion
	var child_min = vec3.create();
	var child_max = vec3.create();

	//test children nodes faces
	var child;
	if(node.c)
		for(var i = 0; i < node.c.length; ++i)
		{
			child = node.c[i];
			child_min.set( child.min );
			child_max.set( child.max );

			//test with node box
			if( !Octree.testSphereBox( origin, radius2, child_min, child_max ) )
				continue;

			//test collision with node content
			if( Octree.testSphereInNode( child, origin, radius2 ) )
				return true;
		}

	return false;
}

//test if one bounding is inside or overlapping another bounding
Octree.isInsideAABB = function(a,b)
{
	if(a.min[0] < b.min[0] || a.min[1] < b.min[1] || a.min[2] < b.min[2] ||
		a.max[0] > b.max[0] || a.max[1] > b.max[1] || a.max[2] > b.max[2])
		return false;
	return true;
}


Octree.hitTestBox = (function(){ 
	var tMin = vec3.create();
	var tMax = vec3.create();
	var inv = vec3.create();
	var t1 = vec3.create();
	var t2 = vec3.create();
	var tmp = vec3.create();
	var epsilon = 1.0e-6;
	var eps = vec3.fromValues( epsilon,epsilon,epsilon );
	
	return function( origin, ray, box_min, box_max ) {
		vec3.subtract( tMin, box_min, origin );
		vec3.subtract( tMax, box_max, origin );
		
		if(	vec3.maxValue(tMin) < 0 && vec3.minValue(tMax) > 0)
			return new HitTest(0,origin,ray);

		inv[0] = 1/ray[0];	inv[1] = 1/ray[1];	inv[2] = 1/ray[2];
		vec3.multiply(tMin, tMin, inv);
		vec3.multiply(tMax, tMax, inv);
		vec3.min(t1, tMin, tMax);
		vec3.max(t2, tMin, tMax);
		var tNear = vec3.maxValue(t1);
		var tFar = vec3.minValue(t2);

		if (tNear > 0 && tNear < tFar) {
			var hit = vec3.add( vec3.create(), vec3.scale(tmp, ray, tNear ), origin);
			vec3.add( box_min, box_min, eps);
			vec3.subtract(box_min, box_min, eps);
			return new HitTest(tNear, hit, vec3.fromValues(
			  (hit[0] > box_max[0]) - (hit[0] < box_min[0]),
			  (hit[1] > box_max[1]) - (hit[1] < box_min[1]),
			  (hit[2] > box_max[2]) - (hit[2] < box_min[2]) ));
		}

		return null;
	}
})();

Octree.hitTestTriangle = (function(){ 
	
	var AB = vec3.create();
	var AC = vec3.create();
	var toHit = vec3.create();
	var tmp = vec3.create();
	
	return function( origin, ray, A, B, C, test_backfaces ) {
		vec3.subtract( AB, B, A );
		vec3.subtract( AC, C, A );
		var normal = vec3.cross( vec3.create(), AB, AC ); //returned
		vec3.normalize( normal, normal );
		if( !test_backfaces && vec3.dot(normal,ray) > 0)
			return null; //ignore backface

		var t = vec3.dot(normal, vec3.subtract( tmp, A, origin )) / vec3.dot(normal,ray);

	    if (t > 0)
		{
			var hit = vec3.scale(vec3.create(), ray, t); //returned
			vec3.add(hit, hit, origin);
			vec3.subtract( toHit, hit, A );
			var dot00 = vec3.dot(AC,AC);
			var dot01 = vec3.dot(AC,AB);
			var dot02 = vec3.dot(AC,toHit);
			var dot11 = vec3.dot(AB,AB);
			var dot12 = vec3.dot(AB,toHit);
			var divide = dot00 * dot11 - dot01 * dot01;
			var u = (dot11 * dot02 - dot01 * dot12) / divide;
			var v = (dot00 * dot12 - dot01 * dot02) / divide;
			if (u >= 0 && v >= 0 && u + v <= 1)
				return new HitTest(t, hit, normal);
		}
	    return null;
	};
})();

//from http://realtimecollisiondetection.net/blog/?p=103
//radius must be squared
Octree.testSphereTriangle = (function(){ 
	
	var A = vec3.create();
	var B = vec3.create();
	var C = vec3.create();
	var AB = vec3.create();
	var AC = vec3.create();
	var BC = vec3.create();
	var CA = vec3.create();
	var V = vec3.create();
	
	return function( P, rr, A_, B_, C_ ) {
		vec3.sub( A, A_, P );
		vec3.sub( B, B_, P );
		vec3.sub( C, C_, P );

		vec3.sub( AB, B, A );
		vec3.sub( AC, C, A );

		vec3.cross( V, AB, AC );
		var d = vec3.dot( A, V );
		var e = vec3.dot( V, V );
		var sep1 = d * d > rr * e;
		var aa = vec3.dot(A, A);
		var ab = vec3.dot(A, B);
		var ac = vec3.dot(A, C);
		var bb = vec3.dot(B, B);
		var bc = vec3.dot(B, C);
		var cc = vec3.dot(C, C);
		var sep2 = (aa > rr) & (ab > aa) & (ac > aa);
		var sep3 = (bb > rr) & (ab > bb) & (bc > bb);
		var sep4 = (cc > rr) & (ac > cc) & (bc > cc);

		var d1 = ab - aa;
		var d2 = bc - bb;
		var d3 = ac - cc;

		vec3.sub( BC, C, B );
		vec3.sub( CA, A, C );

		var e1 = vec3.dot(AB, AB);
		var e2 = vec3.dot(BC, BC);
		var e3 = vec3.dot(CA, CA);

		var Q1 = vec3.scale(vec3.create(), A, e1); vec3.sub( Q1, Q1, vec3.scale(vec3.create(), AB, d1) );
		var Q2 = vec3.scale(vec3.create(), B, e2); vec3.sub( Q2, Q2, vec3.scale(vec3.create(), BC, d2) );
		var Q3 = vec3.scale(vec3.create(), C, e3); vec3.sub( Q3, Q3, vec3.scale(vec3.create(), CA, d3) );

		var QC = vec3.scale( vec3.create(), C, e1 ); QC = vec3.sub( QC, QC, Q1 );
		var QA = vec3.scale( vec3.create(), A, e2 ); QA = vec3.sub( QA, QA, Q2 );
		var QB = vec3.scale( vec3.create(), B, e3 ); QB = vec3.sub( QB, QB, Q3 );

		var sep5 = ( vec3.dot(Q1, Q1) > rr * e1 * e1) & (vec3.dot(Q1, QC) > 0 );
		var sep6 = ( vec3.dot(Q2, Q2) > rr * e2 * e2) & (vec3.dot(Q2, QA) > 0 );
		var sep7 = ( vec3.dot(Q3, Q3) > rr * e3 * e3) & (vec3.dot(Q3, QB) > 0 );

		var separated = sep1 | sep2 | sep3 | sep4 | sep5 | sep6 | sep7
		return !separated;
	};
})();

Octree.testSphereBox = function( center, radius2, box_min, box_max ) {

	// arvo's algorithm from gamasutra
	// http://www.gamasutra.com/features/19991018/Gomez_4.htm
	var s, d = 0.0;
	//find the square of the distance
	//from the sphere to the box
	for(var i = 0; i < 3; ++i) 
	{ 
		if( center[i] < box_min[i] )
		{
			s = center[i] - box_min[i];
			d += s*s; 
		}
		else if( center[i] > box_max[i] )
		{ 
			s = center[i] - box_max[i];
			d += s*s; 
		}
	}
	//return d <= r*r

	if (d <= radius2)
	{
		return true;
		/*
		// this is used just to know if it overlaps or is just inside, but I dont care
		// make an aabb aabb test with the sphere aabb to test inside state
		var halfsize = vec3.fromValues( radius, radius, radius );
		var sphere_bbox = BBox.fromCenterHalfsize( center, halfsize );
		if ( geo.testBBoxBBox(bbox, sphere_bbox) )
			return INSIDE;
		return OVERLAP;	
		*/
	}

	return false; //OUTSIDE;
};