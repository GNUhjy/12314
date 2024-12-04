const socket = io();
let localStream;
let producerTransport;
let producer;
let device;
let consumers = [];
let isVideoEnabled = true;
let isAudioEnabled = true;

async function start() {
    // 로컬 비디오 스트림 가져오기
    try{
    
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById('localVideo').srcObject = localStream;
    } catch (error){
        console.log("스트림 불러오기 실패")
    }

    // 서버에서 Router RTP Capabilities 요청
    socket.emit('getRouterRtpCapabilities', async (data) => {
        console.log('서버에 Rtp 정보 요청')

        try{
            device = new mediasoupClient.Device();
            console.log("디바이스 생성 완료")
            await device.load({ routerRtpCapabilities: data });
            console.log("디바이스 로드 완료");
        } catch(error){
            console.log("디바이스 생성 실패", error)
        }

        // Producer Transport 생성
        await socket.emit('createProducerTransport', {}, async (transportData) => {
            producerTransport = device.createSendTransport(transportData);
            console.log('sendtransport 생성');

            producerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                console.log('producer connect 발생');
                socket.emit('connectProducerTransport', { dtlsParameters }, callback);
            });

            producerTransport.on('produce', async (parameters, callback, errback) => {
                socket.emit('produce', parameters, ({ id }) => {
                    callback({ id });
                    console.log('produce 성공');
                });                
            });

            
            // 로컬 스트림을 서버에 전송
            localStream.getTracks().forEach(track => {
                producerTransport.produce({ track })
            });
        });
        socket.emit('produceDone');
    });
};

// 서버로부터 Consumer 생성 요청 처리
socket.on('newProducer', async ({ producerId, clientId, kind }) => {
    console.log('새로운 producer 연결됨:', kind, producerId);
    
    console.log('consumetransport 생성 요청');
    socket.emit('createConsumerTransport', {}, async (transportData) => {
        let recvTransport = await device.createRecvTransport(transportData);
        console.log('consumertransport 생성 완료');

        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            console.log(dtlsParameters);
            console.log('consumer connect 발생');
            socket.emit('connectConsumerTransport', { dtlsParameters, id : transportData.id }, callback =>{
                console.log('consumer connect 완료');
            });
        });
        
        console.log('consume 시작 직전');
        socket.emit('consume', { producerId, kind : kind, rtpCapabilities: device.rtpCapabilities},async (params) => {
            try {
                console.log(producerId, ' : consume 시도');
                const consumer = await recvTransport.consume({
                            id : params.id, 
                            producerId : params.producerId,
                            kind : params.kind,
                            rtpParameters: params.rtpParameters});
            } catch(errer){
                console.log('.consume 실패')
            }
                
            try{
                console.log('consume 발생');

                const remoteVideo = document.getElementById(clientId);
                if (!remoteVideo) {
                    const videoWrapper = document.createElement('div');
                    videoWrapper.id = clientId;
                    videoWrapper.innerHTML = `<p>클라이언트 ${clientId}</p>`;
                    videoWrapper.autoplay = true;
                    videoWrapper.style.backgroundColor = 'black';
                    videoWrapper.style.width = '300px';
                    videoWrapper.style.height = '200px';

                    if(kind === 'audio'){
                        console.log('오디오 생성');
                        const audioElement = document.createElement('audio');
                        audioElement.autoplay = true;
                        audioElement.controls = true;
                        if (consumer.track) {
                            const mediaStream = new MediaStream([consumer.track]);  // consumer.track을 MediaStream에 추가
                            audioElement.srcObject = mediaStream;
                        }else{console.log('consumer track 을 찾을 수 없음')};
                        videoWrapper.appendChild(audioElement);
                    } else if (kind === 'video') {
                        const videoElement = document.createElement('video');
                        videoElement.autoplay = true;
                        videoElement.controls = true;
                        if (consumer.track) {
                            const mediaStream = new MediaStream([consumer.track]);  // consumer.track을 MediaStream에 추가
                            console.log(mediaStream.constructor.name);
                            videoElement.srcObject = mediaStream;
                        } else {console.log('consumer track 을 찾을 수 없음');}
                        videoWrapper.appendChild(videoElement);
                    }
                    document.getElementById('remoteVideos').appendChild(videoWrapper);
                }
                consumers.push(consumer);
                consumer.resume();
            } catch (error) {console.log(clientId, '의 미디어 가져오기 실패');}
        });
    });
});

socket.on('newClient', ({ clientId }) => {
    const videoWrapper = document.createElement('div');
    videoWrapper.id = clientId;
    videoWrapper.innerHTML = `<p>클라이언트 ${clientId}</p>`;
    const videoElement = document.createElement('video');
    videoElement.autoplay = true;
    //videoElement.controls = true;
    videoElement.style.backgroundColor = 'black'; // 기본 검은색 배경
    videoElement.style.width = '300px'; // 비디오 크기 설정
    videoElement.style.height = '200px';
    videoWrapper.appendChild(videoElement);
    document.getElementById('remoteVideos').appendChild(videoWrapper);
});

socket.on('removeClient', ({ clientId }) => {
    const videoWrapper = document.getElementById(clientId);
    const consumerIndex = consumers.findIndex(c => c.id === clientId);
    if (videoWrapper) {
        videoWrapper.remove();
    }
    if (consumerIndex > -1) {
        consumers[consumerIndex].close();
        consumers.splice(consumerIndex, 1);
    }
});

// 카메라와 마이크 제어 기능
document.getElementById('toggleVideo').addEventListener('click', () => {
    isVideoEnabled = !isVideoEnabled;
    localStream.getVideoTracks().forEach(track => track.enabled = isVideoEnabled);
});

document.getElementById('toggleAudio').addEventListener('click', () => {
    isAudioEnabled = !isAudioEnabled;
    localStream.getAudioTracks().forEach(track => track.enabled = isAudioEnabled);
});

start();