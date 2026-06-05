// Mind Agency Logo — 3D Noise Sphere
// 编译注入: uTime, uResolution
// 参数: camZ=-14, noiseAmp=2.9

vec3 palette(float d){
    return mix(vec3(0.2,0.7,0.9),vec3(1.,0.,1.),d);
}

vec2 rotate(vec2 p,float a){
    float c = cos(a);
    float s = sin(a);
    return p*mat2(c,s,-s,c);
}

float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i + vec3(0,0,0)),
                        hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)),
                        hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)),
                        hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)),
                        hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
    float v = 0.0;
    float a = 0.5;
    vec3 shift = vec3(100.0);
    for (int i = 0; i < 5; ++i) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
    }
    return v;
}

float map(vec3 p){
    float sphere = length(p);
    vec3 q = p * 0.2;
    float n = fbm(q + vec3(uTime * 0.2));
    float d = sphere - n * 2.9;
    return d;
}

vec4 rm (vec3 ro, vec3 rd){
    float t = 0.;
    vec3 col = vec3(0.);
    float d;
    for(float i =0.; i<80.; i++){
        vec3 p = ro + rd*t;
        d = map(p);
        if(d < 0.02 || t > 100.0){
            break;
        }
        col += palette(length(p) * 0.1) / (300. * d);
        t += d;
    }
    return vec4(col, 1. / (d * 100.));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - uResolution.xy / 2.) / uResolution.x;
    vec3 ro = vec3(0., 0., -14.);
    ro.xz = rotate(ro.xz, uTime * 0.3);

    vec3 cf = normalize(-ro);
    vec3 cs = normalize(cross(cf, vec3(0., 1., 0.)));
    vec3 cu = normalize(cross(cf, cs));

    vec3 uuv = ro + cf * 3. + uv.x * cs + uv.y * cu;
    vec3 rd = normalize(uuv - ro);

    vec4 col = rm(ro, rd);
    gl_FragColor = col;
}
