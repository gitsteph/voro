/**
 * @author Jimmy Andrews / jimmylands.com
 * 
 * For filling the gap between my js wrapper of voro++ and three.js
 */
/* global THREE, Module */
/*jshint -W008 */
/*jslint devel: true, indent: 4, maxerr: 50 */
"use strict";

// e.g. call with
// v3 = new Voro3([-10, -10, -10], [10, 10, 10]);
// you MUST CALL v3.delete() if/when you're done using the object but want to stay on the same page to tell the c++ module to free memory


var Voro3 = function () {
    
    this.est_max_preview_verts = 1024;
    this.est_max_tris = 32768;
    this.est_max_cell_sites = 10000;
    this.tracked_acts = [];
    this.action_tracking = false;
    var that = this;

    this.start_tracking = function(yes) {
        if (yes === undefined || yes) {
            this.action_tracking = true;
        } else {
            this.action_tracking = false;
        }
        this.tracked_acts = [];
    }

    this.inds_to_ids = function(inds) {
        var res = [];
        for (var i=0; i<inds.length; i++) {
            res.push(this.voro.stable_id(inds[i]));
        }
        return res;
    };
    this.ids_to_inds = function(ids) {
        var res = [];
        for (var i=0; i<ids.length; i++) {
            var ind = this.voro.index_from_id(ids[i]);
            if (ind >= 0) {
                res.push(ind);
            }
        }
        return res;
    };

    var AddAct = function(cells, pts, states) {
        var cell_ids = that.inds_to_ids(cells);
        this.redo = function() {
            for (var i=0; i<cell_ids.length; i++) {
                var cell_ind = that.voro.add_cell(pts[i], states[i]);
                that.voro.set_stable_id(cell_ind, cell_ids[i]);
            }
        }
        this.undo = function() {
            var inds = that.ids_to_inds(cell_ids);
            for (var i=0; i<inds.length; i++) {
                that.voro.delete_cell(inds[i]);
            }
        }
    }

    this.undo = function(seq) {
        for (var i=seq.length-1; i>=0; i--) {
            seq[i].undo(this);
        }
    };
    this.redo = function(seq) {
        for (var i=0; i<seq.length; i++) {
            seq[i].redo(this);
        }
    }

    this.pop_acts = function() { // retrieves and clears all accumulated actions (e.g. since last call to pop_acts)
        assert(this.action_tracking);
        var acts = this.tracked_acts;
        this.tracked_acts = [];
        return acts;
    }

    this.track_act = function(act) {
        if (this.action_tracking) {
            this.tracked_acts.push(act);
        }
    }

    
    this.add_to_scene = function(scene) {
        if (this.preview_lines) {
            scene.add(this.preview_lines);
        }
        if (this.mesh) {
            scene.add(this.mesh);
        }
        if (this.sites_points) {
            scene.add(this.sites_points);
        }
    };
    
    this.create_voro = function(min_point, max_point) {
        this.min_point = min_point;
        this.max_point = max_point;
        if (this.voro) {
            this.voro.delete();
        }
        this.voro = new Module.Voro(this.min_point,this.max_point);
    };
    
    this.generate = function(scene, min_point, max_point, generator_fn, numPts, seed, fill_level) {
        this.create_voro(min_point, max_point);
        
        Math.seedrandom(seed);
        
        this.start_tracking(false);
        generator_fn(numPts, this.voro);
        if (fill_level === 0) {
            this.voro.set_only_centermost(1,0);
        } else {
            this.voro.set_fill(fill_level/100.0, Math.random()*2147483648);
        }
        
        this.create_gl_objects(scene);
        
        this.add_to_scene(scene);

        this.start_tracking();
    };

    this.generate_from_buffer = function(scene, buffer) {
        var was_tracking = this.action_tracking;
        this.start_tracking(false);
        var valid = this.create_from_raw_buffer(buffer);
        if (!valid) {
            this.start_tracking(was_tracking);
            return false;
        }
        
        this.create_gl_objects(scene);
        
        this.add_to_scene(scene);

        this.start_tracking();

        return true;
    };

    this.create_gl_objects = function(scene) {
        this.geometry = this.init_geometry(this.est_max_tris, this.est_max_preview_verts, this.est_max_cell_sites);
        this.material = new THREE.MeshPhongMaterial( { color: 0xaaaaaa, specular: 0x111111, shininess: 5, shading: THREE.FlatShading } ) ;
        //    material = new THREE.MeshBasicMaterial( { color: 0xffffff, wireframe: true } ) ;
        if (this.mesh) {
            scene.remove(this.mesh);
        }
        this.mesh = new THREE.Mesh( this.geometry, this.material );
        
        this.preview_geometry = this.init_preview();
        this.preview_material = new THREE.LineBasicMaterial( { color: 0xffffff, linewidth: 0.5, transparent: false } );
        if (this.preview_lines) {
            scene.remove(this.preview_lines);
        }
        this.preview_lines = new THREE.LineSegments(this.preview_geometry, this.preview_material);
        this.preview_lines.visible = false;

        this.sites_geometry = this.init_sites();
        this.sites_material = new THREE.PointsMaterial( { size: 0.05, color: 0xffffff } );
        if (this.sites_points) {
            scene.remove(this.sites_points);
        }
        this.sites_points = new THREE.Points(this.sites_geometry, this.sites_material);
    };
    
    this.alloc_geometry = function(geometry) {
        this.verts_ptr = this.voro.gl_vertices();
        var max_tris = this.voro.gl_max_tris();
        var array = Module.HEAPF32.subarray(this.verts_ptr/4, this.verts_ptr/4 + max_tris*3*3);
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    };
    this.init_geometry = function(est_max_tris, est_max_preview_verts, est_max_cell_sites) {
        var geometry = new THREE.BufferGeometry();
        this.voro.gl_build(est_max_tris, est_max_preview_verts, est_max_cell_sites);
        this.alloc_geometry(geometry);
        geometry.name = 'voro3';
        var num_tris = this.voro.gl_tri_count();
        geometry.setDrawRange(0, num_tris*3);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();

        return geometry;
    };
    this.realloc_geometry = function() {
        this.geometry.removeAttribute('position');
        this.alloc_geometry(this.geometry);
    };
    
    this.alloc_preview = function(geometry) {
        this.preview_verts_ptr = this.voro.gl_wire_vertices();
        var verts_ptr = this.preview_verts_ptr; // just to give it a shorter name
        var max_verts = this.voro.gl_wire_max_verts();
        var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_verts*3);
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    };
    this.init_preview = function() {
        var geometry = new THREE.BufferGeometry();
        this.alloc_preview(geometry);
        geometry.name = 'voro3_preview';
        var num_verts = this.voro.gl_wire_vert_count();
        geometry.setDrawRange(0, num_verts);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();
        return geometry;
    };
    this.realloc_preview = function() {
        this.preview_geometry.removeAttribute('position');
        this.alloc_preview(this.preview_geometry);
    };

    this.alloc_sites = function(geometry) {
        this.sites_verts_ptr = this.voro.gl_cell_sites();
        var verts_ptr = this.sites_verts_ptr; // just to give it a shorter name
        var max_verts = this.voro.gl_max_sites();
        var array = Module.HEAPF32.subarray(verts_ptr/4, verts_ptr/4 + max_verts*3);
        var vertices = new THREE.BufferAttribute(array, 3);
        geometry.addAttribute('position', vertices);
    };
    this.init_sites = function() {
        var geometry = new THREE.BufferGeometry();
        this.alloc_sites(geometry);
        geometry.name = 'voro3_sites';
        var num_verts = this.voro.cell_count();
        geometry.setDrawRange(0, num_verts);
        var box = new THREE.Box3(this.min_point, this.max_point);
        geometry.boundingSphere = box.getBoundingSphere();
        return geometry;
    };
    this.realloc_sites = function() {
        this.sites_geometry.removeAttribute('position');
        this.alloc_sites(this.sites_geometry);
    };
    
    this.add_cell = function (pt_3, state) {
        if (state === undefined) {
            state = true;
        }
        var pt = [pt_3.x, pt_3.y, pt_3.z];
        var cell = this.voro.add_cell(pt, state);
        this.track_act(new AddAct([cell],[pt],[state]));
        this.update_geometry();
        return cell;
    };
    this.move_cell = function(cell, pt_arr) {
        this.voro.move_cell(cell, pt_arr);
        this.update_geometry();
    };
    this.move_cells = function(cells, pts_arr) {
        this.voro.move_cells(cells, pts_arr);
        this.update_geometry();
    };
    this.update_sites = function() {
        var num_sites = this.voro.cell_count();
        var current_sites_ptr = this.voro.gl_cell_sites();
        if (current_sites_ptr !== this.sites_verts_ptr) {
            this.realloc_sites();
        }
        this.sites_geometry.setDrawRange(0, num_sites);
        this.sites_geometry.attributes.position.needsUpdate = true;
    };
    this.update_geometry = function () {
        var num_tris = this.voro.gl_tri_count();
        var current_verts_ptr = this.voro.gl_vertices();
        if (current_verts_ptr !== this.verts_ptr) {
            this.realloc_geometry();
        }
        this.geometry.setDrawRange(0, num_tris*3);
        this.geometry.attributes.position.needsUpdate = true;
        this.update_sites();
    };
    this.update_preview = function() {
        var num_verts = this.voro.gl_wire_vert_count();
        var current_verts_ptr = this.voro.gl_wire_vertices();
        if (current_verts_ptr !== this.preview_verts_ptr) {
            this.realloc_preview();
        }
        this.preview_geometry.setDrawRange(0, num_verts);
        this.preview_geometry.attributes.position.needsUpdate = true;
    };
    
    this.raycast_vertex_index = function(mouse, camera, caster) {
        caster.setFromCamera(mouse, camera);

        var intersects = caster.intersectObject(this.mesh);
        if (intersects.length === 0)
            return -1;
        
        var intersect = intersects[0];
        return intersect.index;
    };

    this.raycast_pt = function(mouse, camera, caster) {
        caster.setFromCamera(mouse, camera);
        
        var intersects = caster.intersectObject(this.mesh);
        if (intersects.length === 0)
            return null;
        
        var intersect = intersects[0];
        return intersect.point;
    };
    this.raycast = function(mouse, camera, caster) {
        var index = this.raycast_vertex_index(mouse, camera, caster);
        if (index < 0)
            return index;
        
        return this.voro.cell_from_vertex(index);
    };
    this.raycast_neighbor = function(mouse, camera, caster) {
        var index = this.raycast_vertex_index(mouse, camera, caster);
        if (index < 0)
            return index;
        
        return this.voro.cell_neighbor_from_vertex(index);
    };

    this.clear_preview = function() {
        this.voro.gl_clear_wires();
        this.preview_lines.visible = false;
    };
    this.add_preview = function(cell) {
        if (cell < 0) {
            this.preview_lines.visible = false;
            return;
        }
        this.voro.gl_add_wires(cell);
        this.preview_lines.visible = true;
    };
    this.set_preview = function(cell) {
        this.clear_preview();
        this.add_preview(cell);
        this.update_preview();
    };
    

    this.toggle_cell = function(cell) {
        this.voro.toggle_cell(cell);
        this.update_geometry();
    };

    this.delete_cell = function(cell) {
        this.voro.delete_cell(cell);
        this.update_geometry();
    };
    this.cell_pos = function(cell) {
        return this.voro.cell_pos(cell);
    };
    this.cell_type = function(cell) {
        return this.voro.cell_type(cell);
    };
    this.sanity = function(name) {
        return this.voro.sanity(name||"unlabelled sanity check");
    };

    this.delete = function() {
        this.voro.delete();
    };




    // export functions

    this.get_binary_stl_buffer = function() {
        this.verts_ptr = this.voro.gl_vertices();
        var num_tris = this.voro.gl_tri_count();
        var array = Module.HEAPF32.subarray(this.verts_ptr/4, this.verts_ptr/4 + num_tris*3*3);
        var buffer = new ArrayBuffer(80+4+num_tris*(4*4*3+2)); // buffer w/ space for whole stl
        var view = new DataView(buffer);
        view.setInt32(80, num_tris, true);
        for (var i=0; i<num_tris; i++) {
            for (var vi=0; vi<3; vi++) {
                for (var di=0; di<3; di++) {
                    view.setFloat32(80+4+i*(4*4*3+2)+4*3*(vi+1)+4*di, array[i*3*3+vi*3+di], true);
                }
            }
        }
        return buffer;
    };

    // custom binary file format
    // v1: [int32 file_type_id_number=1619149277] [int32 ver=1]
    //       {[float32 x] [float32 y] [float32 z]}*3*2 (<- the bounding box min and max points)
    //       [int32 types_count] {[int32 type] [int32 count] {[float32 x] [float32 y] [float32 z]}*count}*state_count
    this.get_binary_raw_buffer = function() {
        var key, k, i, t;
        var num_cells = this.voro.cell_count();
        var type_counts = {};
        for (i=0; i<num_cells; i++) {
            t = this.voro.cell(i).type;
            type_counts[t] = type_counts[t] || 0;
            type_counts[t] += 1;
        }
        var sorted_types = Object.keys(type_counts);
        sorted_types.sort();
        var num_types = sorted_types.length;
        var type_starts = {};

        var header_size = 4+4+2*3*4+4; // special number and version and bounding box min&max and # types
        var typeblock_header_size = 4+4; // type id and num cells w/ that type
        var cell_size = 3*4; // 3 float32s (just posn)

        var start = header_size;
        for (k=0; k<num_types; k++) {
            key = sorted_types[k];
            type_starts[key] = start;
            start += typeblock_header_size+type_counts[key]*cell_size;
        }
        var total_size = start;
        
        var buffer = new ArrayBuffer(total_size);
        var view = new DataView(buffer);
        view.setInt32(0, 1619149277, true);
        view.setInt32(4, 1, true); // version
        for (i=0; i<3; i++) {
            view.setFloat32(   8+i*4, this.min_point[i], true);
            view.setFloat32(8+12+i*4, this.max_point[i], true);
        }
        view.setInt32(8+24, num_types, true); // types_count

        var type_place_in_arr = {};

        // put the header for each type block
        for (k=0; k<num_types; k++) {
            key = sorted_types[k];
            view.setInt32(type_starts[key]+0, key, true);
            view.setInt32(type_starts[key]+4, type_counts[key], true);
            type_place_in_arr[key] = type_starts[key]+typeblock_header_size;
        }

        for (i=0; i<num_cells; i++) {
            var c = this.voro.cell(i);
            t = c.type;
            var place_in_arr = type_place_in_arr[t];
            view.setFloat32(place_in_arr+0, c.pos[0], true);
            view.setFloat32(place_in_arr+4, c.pos[1], true);
            view.setFloat32(place_in_arr+8, c.pos[2], true);
            type_place_in_arr[t] = place_in_arr + cell_size;
        }

        return buffer;
    };

    this.create_from_raw_buffer = function(buffer) {
        var view = new DataView(buffer);
        var idflag = view.getInt32(0, true);
        if (idflag != 1619149277) {
            console.log("WARNING: tried to load from raw buffer but it didn't have the magic number in front -- so is not a voro buffer!");
            return false;
        }
        var version = view.getInt32(4, true);
        if (version != 1) {
            console.log("WARNING: tried to load cells from raw buffer but found unknown version id: " + version);
            return false;
        }

        var header_size = 8;

        var offset = header_size;
        var bbmin = 
            [view.getFloat32(offset+0, true),
             view.getFloat32(offset+4, true),
             view.getFloat32(offset+8, true)];
        offset += 12;
        var bbmax =
            [view.getFloat32(offset+0, true),
             view.getFloat32(offset+4, true),
             view.getFloat32(offset+8, true)];
        offset += 12;
        this.create_voro(bbmin, bbmax);


        var cur_pos = offset;
        var num_types = view.getInt32(cur_pos, true);
        cur_pos += 4;
        for (var i=0; i<num_types; i++) {
            var type = view.getInt32(cur_pos, true); cur_pos += 4;
            var num_pts = view.getInt32(cur_pos, true); cur_pos += 4;
            for (var pi=0; pi<num_pts; pi++) {
                var x = view.getFloat32(cur_pos, true); cur_pos += 4;
                var y = view.getFloat32(cur_pos, true); cur_pos += 4;
                var z = view.getFloat32(cur_pos, true); cur_pos += 4;
                this.voro.add_cell([x,y,z], type);
            }
        }

        return true;
    };





    // Chaos functions are part of sanity checking / debugging code
    var chaos_limit = 1000;
    this.do_chaos = function() {
        var cell = 0;
        var sanity = true;

        if (chaos_limit===1000) this.voro.set_sanity_level(0);
        
        if (chaos_limit === null || chaos_limit-- > 0) {
            var choice = Math.random()*4;
            if (Math.floor(choice) === 0) {
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
                this.voro.toggle_cell(cell);
            }
            else if (Math.floor(choice) === 1) {
                this.voro.delete_cell(0);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
                cell = Math.floor(Math.random()*this.voro.cell_count());
                this.voro.delete_cell(cell);
            } else if (Math.floor(choice) === 2) {
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([Math.random()*20-10,Math.random()*20-10,Math.random()*20-10], true);
                this.voro.add_cell([1,1,1], true);
                this.voro.add_cell([1+Math.random()*.001,1+Math.random()*.001,1+Math.random()*.001], true);
                this.voro.add_cell([0,Math.random()*.1-.05,0], true);
                this.voro.add_cell([0,Math.random()*1000-500,0], true);
            } else {
                this.voro.move_cell(Math.random()*this.voro.cell_count(),[Math.random()*20-10,Math.random()*20-10,Math.random()*20-10]);
                this.voro.move_cell(Math.random()*this.voro.cell_count(),[0,Math.random()*1000-500,0]);
                this.voro.move_cell(0,[0,Math.random()*40-20,0]);
                var pos = [Math.random()*20-10,Math.random()*20-10,Math.random()*20-10];
                cell = this.voro.add_cell(pos, true);
                this.voro.move_cell(cell,pos);
                pos[0] += 0.01;
                this.voro.move_cell(cell,pos);
            }
            var preview_cell = Math.floor(Math.random()*this.voro.cell_count());
            this.set_preview(preview_cell);
            this.update_geometry();
            
            if (chaos_limit%30===0) {
                this.voro.set_sanity_level(1);
                sanity = this.sanity("after chaos_limit="+chaos_limit);
                this.voro.set_sanity_level(0);
            }
        }

        // if we're done, check sanity
        if (chaos_limit !== null && chaos_limit === 0) {
            console.log("chaos over -- checking sanity at end ...");
            this.voro.set_sanity_level(9001);
            sanity = this.sanity("after chaos");
            console.log("sanity = " + sanity);
        }
    };
};

Voro3.prototype.constructor = Voro3;