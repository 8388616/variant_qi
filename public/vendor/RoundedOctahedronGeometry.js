( function () {

    // ============================================================
    // RoundedOctahedronGeometry —— 照 three.js 官方 RoundedBoxGeometry 的思路改造
    // 原理（与 RoundedBox 完全同构）：
    //   骰子表面 = "内缩八面体"表面每个点，沿着从中心向外的方向走 r。
    //   - 内缩八面体的面  → 外推 r（沿面法线）→ 原始面（平面）
    //   - 内缩八面体的棱  → 外推 r（斜向）    → 圆弧
    //   - 内缩八面体的角  → 外推 r（对角）    → 球面（角圆）
    // 实现（对照 RoundedBox 的三行）：
    //   1) normal = normalize(position - 象限符号×halfSegment)   // RoundedBox 的 sign×half
    //   2) 内缩点 = position × (1 - r√3/R)                        // RoundedBox 的 box×sign
    //       —— 径向内缩（位置决定、跨面连续）；面心外推后正好落回原始面
    //   3) 顶点 = 内缩点 + normal × r                              // RoundedBox 的 + normal×radius
    // ============================================================

    class RoundedOctahedronGeometry extends THREE.OctahedronGeometry {

        constructor( radius = 1, segments = 2, r = 0.1 ) {

            segments = segments * 2 + 1;
            r = Math.min( radius * 0.5, r );
            super( 1, segments );

            if ( segments === 1 ) return;
            const geometry2 = this.toNonIndexed();
            this.index = null;
            this.attributes.position = geometry2.attributes.position;
            this.attributes.normal = geometry2.attributes.normal;
            this.attributes.uv = geometry2.attributes.uv;

            const position = new THREE.Vector3();
            const normal = new THREE.Vector3();
            const invSqrt3 = 1 / Math.sqrt( 3 );
            const rp = r / radius;                       // 单位尺度的圆角半径
            const shrink = 1 - rp * Math.sqrt( 3 );      // 径向内缩比例（面心外推后 = 原始面）
            const positions = this.attributes.position.array;
            const normals = this.attributes.normal.array;
            const uvs = this.attributes.uv.array;
            const halfSegmentSize = 0.5 / segments;

            for ( let i = 0, j = 0; i < positions.length; i += 3, j += 2 ) {

                position.fromArray( positions, i );

                // 细分顶点在单位球面（PolyhedronGeometry 投影）——拉回八面体面平面
                const qx = Math.sign( position.x ) || 1;
                const qy = Math.sign( position.y ) || 1;
                const qz = Math.sign( position.z ) || 1;
                const qp = qx * position.x + qy * position.y + qz * position.z;
                position.multiplyScalar( 1 / Math.max( Math.abs( qp ), 1e-9 ) );

                // 1) normal = normalize(position - 象限符号×half)（照 RoundedBox）
                normal.copy( position );
                normal.x -= qx * invSqrt3 * halfSegmentSize;
                normal.y -= qy * invSqrt3 * halfSegmentSize;
                normal.z -= qz * invSqrt3 * halfSegmentSize;
                normal.normalize();

                // 2)+3) 顶点 = 径向内缩 + normal×r（照 RoundedBox 的 box×sign + normal×radius）
                positions[ i + 0 ] = ( position.x * shrink + normal.x * rp ) * radius;
                positions[ i + 1 ] = ( position.y * shrink + normal.y * rp ) * radius;
                positions[ i + 2 ] = ( position.z * shrink + normal.z * rp ) * radius;

                normals[ i + 0 ] = normal.x;
                normals[ i + 1 ] = normal.y;
                normals[ i + 2 ] = normal.z;

                // UV 暂用纹理中心（点数 UV 在调用处按面重心坐标修正）
                uvs[ j + 0 ] = 0.5;
                uvs[ j + 1 ] = 0.5;

            }

        }

    }

    THREE.RoundedOctahedronGeometry = RoundedOctahedronGeometry;

} )();
